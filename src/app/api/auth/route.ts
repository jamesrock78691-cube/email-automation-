import { NextRequest, NextResponse } from "next/server";
import { db, ensureSchemaReady } from "@/db";
import { users, settings, gmailAccounts } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import nodemailer from "nodemailer";
import { smtpFromAddress, smtpLoginUser } from "@/lib/smtpAccount";
import bcrypt from "bcryptjs";
import { resolveWorkspace, settingKey, MAIN_WORKSPACE } from "@/lib/workspace";

const SUPER_ADMIN_RECOVERY_EMAIL =
  process.env.SUPER_ADMIN_RECOVERY_EMAIL || "jamesrock78691@gmail.com";

const SECRET: string =
  process.env.AUTH_SECRET ??
  (() => {
    throw new Error("AUTH_SECRET environment variable is required");
  })();

const SESSION_DAYS = 7;

export const ALL_PERMISSIONS = [
  "compose",
  "dashboard",
  "sheets",
  "gmail",
  "templates",
  "campaigns",
  "admin_panel",
  "smtp_view",
  "smtp_add",
  "smtp_delete",
  "manage_users",
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

const DEFAULT_BY_ROLE: Record<string, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  admin: [
    "compose",
    "dashboard",
    "sheets",
    "gmail",
    "templates",
    "campaigns",
    "admin_panel",
    "smtp_add",
    "manage_users",
  ],
  operator: ["compose", "templates"],
};

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

async function setJsonSetting(key: string, value: any) {
  const str = JSON.stringify(value);
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  if (existing.length) {
    await db.update(settings).set({ value: str }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value: str });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureSchemaReady();
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
      const found = await db
        .select()
        .from(users)
        .where(sql`lower(${users.username}) = ${uname.toLowerCase()}`)
        .limit(1);
      if (!found.length) {
        return NextResponse.json(
          { success: false, error: "Invalid credentials" },
          { status: 401 }
        );
      }
      const user = found[0];
      const stored = user.passwordHash || "";
      let passwordMatch = false;
      if (
        stored.startsWith("$2a$") ||
        stored.startsWith("$2b$") ||
        stored.startsWith("$2y$")
      ) {
        passwordMatch = await bcrypt.compare(password, stored);
      } else {
        passwordMatch = stored === password;
        if (passwordMatch) {
          try {
            const newHash = await bcrypt.hash(password, 10);
            await db
              .update(users)
              .set({ passwordHash: newHash })
              .where(eq(users.id, user.id));
          } catch (e) {
            console.error("Failed to upgrade password hash:", e);
          }
        }
      }
      if (!passwordMatch) {
        return NextResponse.json(
          { success: false, error: "Invalid credentials" },
          { status: 401 }
        );
      }
      let role = normalizeRole(user.role);
      if (user.username === "superadmin" || user.role === "super_admin") {
        role = "super_admin";
      }
      if (user.username === "admin") role = "super_admin";
      if (user.username === "amazon") role = "super_admin";
      if (String(user.username).toLowerCase() === "sandeer") role = "super_admin";

      const token = createToken({
        id: user.id,
        username: user.username,
        role,
        workspace: (user as any).workspace,
      });
      const ws = resolveWorkspace(user.username, (user as any).workspace);

      return NextResponse.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          role,
          workspace: ws,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("Auth POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
