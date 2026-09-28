import { NextRequest, NextResponse } from "next/server";
import { db, pool, ensureSchemaReady } from "@/db";
import { users, settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createHmac } from "crypto";
import bcrypt from "bcryptjs";
import { resolveWorkspace } from "@/lib/workspace";

const SECRET: string =
  process.env.AUTH_SECRET ??
  (() => {
    throw new Error("AUTH_SECRET environment variable is required");
  })();

const SESSION_DAYS = 7;

function b64url(data: string | Buffer) {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlJson(obj: object) {
  return b64url(JSON.stringify(obj));
}

function sign(payloadB64: string) {
  return createHmac("sha256", SECRET).update(payloadB64).digest("hex");
}

function createToken(user: {
  id: number;
  username: string;
  role: string;
  workspace?: string;
}) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const ws = resolveWorkspace(user.username, user.workspace);
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role || "operator",
    workspace: ws,
    exp,
  };
  const payloadB64 = b64urlJson(payload);
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

function normalizeRole(role: string): string {
  const r = (role || "").toLowerCase().replace(/-/g, "_").trim();
  if (r === "super_admin" || r === "superadmin") return "super_admin";
  if (r === "admin") return "admin";
  return "operator";
}

/** Force users table + workspace column + default admins (raw SQL, no Drizzle). */
async function ensureUsersTableForLogin() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      role text DEFAULT 'admin' NOT NULL,
      workspace text DEFAULT 'main' NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `);
  try {
    await pool.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS workspace text DEFAULT 'main'`
    );
  } catch (e: any) {
    console.error("ALTER users.workspace:", e?.message || e);
  }
  try {
    await pool.query(
      `UPDATE users SET workspace = 'main' WHERE workspace IS NULL OR workspace = ''`
    );
  } catch {
    /* ignore */
  }

  const bcryptjs = (await import("bcryptjs")).default;
  const hash = await bcryptjs.hash("cubetech26", 10);

  const defaults: Array<[string, string, string]> = [
    ["admin", "super_admin", "main"],
    ["amazon", "super_admin", "amazon"],
    ["sandeer", "super_admin", "sandeer"],
  ];
  for (const [username, role, workspace] of defaults) {
    const exists = await pool.query(
      `SELECT id FROM users WHERE lower(username) = $1 LIMIT 1`,
      [username]
    );
    if (!exists.rowCount) {
      await pool.query(
        `INSERT INTO users (username, password_hash, role, workspace)
         VALUES ($1, $2, $3, $4)`,
        [username, hash, role, workspace]
      );
      console.log(`[AUTH] created user ${username} @ ${workspace}`);
    } else {
      await pool.query(
        `UPDATE users SET role = $2, workspace = $3 WHERE lower(username) = $1`,
        [username, role, workspace]
      );
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    // Best-effort full schema; login still works if this partially fails
    try {
      await ensureSchemaReady();
    } catch (e: any) {
      console.error("ensureSchemaReady (non-fatal for login):", e?.message || e);
    }

    // Always force users table right before login query
    await ensureUsersTableForLogin();

    const body = await req.json();
    const action = body.action;

    if (action === "login") {
      const { username, password } = body;
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: "Username and password required" },
          { status: 400 }
        );
      }
      const uname = String(username).trim();

      // Raw SQL — never selects a missing column via Drizzle schema mismatch
      let result;
      try {
        result = await pool.query(
          `SELECT id, username, password_hash, role,
                  COALESCE(workspace, 'main') AS workspace
           FROM users
           WHERE lower(username) = lower($1)
           LIMIT 1`,
          [uname]
        );
      } catch (qErr: any) {
        // Last resort: table without workspace column
        console.error("login query failed, retry minimal:", qErr?.message);
        try {
          await pool.query(
            `ALTER TABLE users ADD COLUMN workspace text DEFAULT 'main'`
          );
        } catch {
          /* ignore */
        }
        result = await pool.query(
          `SELECT id, username, password_hash, role
           FROM users WHERE lower(username) = lower($1) LIMIT 1`,
          [uname]
        );
        if (result.rows[0] && result.rows[0].workspace == null) {
          result.rows[0].workspace = "main";
        }
      }

      if (!result.rows.length) {
        return NextResponse.json(
          { success: false, error: "Invalid credentials" },
          { status: 401 }
        );
      }

      const row = result.rows[0];
      const stored = String(row.password_hash || "");
      let passwordMatch = false;
      if (
        stored.startsWith("$2a$") ||
        stored.startsWith("$2b$") ||
        stored.startsWith("$2y$")
      ) {
        passwordMatch = await bcrypt.compare(String(password), stored);
      } else {
        passwordMatch = stored === String(password);
        if (passwordMatch) {
          try {
            const newHash = await bcrypt.hash(String(password), 10);
            await pool.query(
              `UPDATE users SET password_hash = $1 WHERE id = $2`,
              [newHash, row.id]
            );
          } catch (e) {
            console.error("hash upgrade failed:", e);
          }
        }
      }

      if (!passwordMatch) {
        return NextResponse.json(
          { success: false, error: "Invalid credentials" },
          { status: 401 }
        );
      }

      let role = normalizeRole(String(row.role || ""));
      const unameLower = String(row.username || "").toLowerCase();
      if (
        unameLower === "admin" ||
        unameLower === "superadmin" ||
        unameLower === "amazon" ||
        unameLower === "sandeer" ||
        row.role === "super_admin"
      ) {
        role = "super_admin";
      }

      const token = createToken({
        id: Number(row.id),
        username: String(row.username),
        role,
        workspace: String(row.workspace || "main"),
      });
      const ws = resolveWorkspace(
        String(row.username),
        String(row.workspace || "main")
      );

      return NextResponse.json({
        success: true,
        token,
        user: {
          id: Number(row.id),
          username: String(row.username),
          role,
          workspace: ws,
        },
      });
    }

    // Other actions need full auth file (restored on build). Keep minimal stub.
    return NextResponse.json(
      { success: false, error: "Unknown action (redeploy may still be running)" },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("Auth POST error:", err);
    return NextResponse.json(
      {
        success: false,
        error: err?.message || "Server error",
        detail: err?.cause?.message || err?.code || undefined,
      },
      { status: 500 }
    );
  }
}
