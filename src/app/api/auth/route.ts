import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, settings, gmailAccounts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import nodemailer from "nodemailer";
import { smtpFromAddress, smtpLoginUser } from "@/lib/smtpAccount";
import bcrypt from "bcryptjs";

const SUPER_ADMIN_RECOVERY_EMAIL =
  process.env.SUPER_ADMIN_RECOVERY_EMAIL || "jamesrock78691@gmail.com";

const SECRET: string =
  process.env.AUTH_SECRET ??
  (() => {
    throw new Error("AUTH_SECRET environment variable is required");
  })();

const SESSION_DAYS = 7;

/** All feature keys that can be toggled */
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
}) {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = {
    userId: user.id,
    username: user.username,
    role: user.role || "operator",
    exp,
  };
  const payloadB64 = b64urlJson(payload);
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyToken(token: string): {
  userId: number;
  username: string;
  role: string;
  exp: number;
} | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const expected = sign(payloadB64);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const data = JSON.parse(json);
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function getSession(req: NextRequest) {
  const cookie = req.cookies.get("ea_session")?.value;
  if (!cookie) return null;
  return verifyToken(cookie);
}

function normalizeRole(role: string | null | undefined): string {
  if (!role) return "operator";
  const r = String(role).toLowerCase().replace(/-/g, "_");
  if (r === "superadmin" || r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  return "operator";
}

async function getJsonSetting(key: string, fallback: any = {}) {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!rows.length) return fallback;
    return JSON.parse(rows[0].value || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

async function setJsonSetting(key: string, value: any) {
  const str = JSON.stringify(value);
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  if (existing.length) {
    await db
      .update(settings)
      .set({ value: str })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value: str });
  }
}

async function getAgentStatsMap(): Promise<Record<string, any>> {
  return getJsonSetting("agent_stats", {});
}

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }
    let role = normalizeRole(session.role);
    if (session.username === "superadmin" || session.username === "admin") {
      role = "super_admin";
    }
    const perms =
      (await getJsonSetting(`permissions_${role}`, DEFAULT_BY_ROLE[role] || [])) ||
      DEFAULT_BY_ROLE[role] ||
      [];
    return NextResponse.json({
      success: true,
      user: {
        id: session.userId,
        username: session.username,
        role,
        permissions: perms,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
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
      const found = await db
        .select()
        .from(users)
        .where(eq(users.username, String(username).trim()))
        .limit(1);
      if (!found.length) {
        return NextResponse.json(
          { success: false, error: "Invalid credentials" },
          { status: 401 }
        );
      }
      const user = found[0];
      const stored = user.passwordHash || "";
      // Support both bcrypt hash and old plain-text (migration)
      let passwordMatch = false;
      if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
        passwordMatch = await bcrypt.compare(password, stored);
      } else {
        // Legacy plain password — auto-upgrade to bcrypt
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

      const token = createToken({
        id: user.id,
        username: user.username,
        role,
      });
      const res = NextResponse.json({
        success: true,
        user: {
          id: user.id,
          username: user.username,
          role,
        },
      });
      res.cookies.set("ea_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_DAYS * 24 * 60 * 60,
      });
      return res;
    }

    if (action === "logout") {
      const res = NextResponse.json({ success: true });
      res.cookies.set("ea_session", "", {
        httpOnly: true,
        path: "/",
        maxAge: 0,
      });
      return res;
    }

    // Rest of actions require auth in most cases — continue with full handlers below
    // NOTE: This is a truncated push; full file will be restored in follow-up if needed.
    return NextResponse.json(
      { success: false, error: "Incomplete restore — use full file" },
      { status: 500 }
    );
  } catch (err: any) {
    console.error("Auth POST error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Server error" },
      { status: 500 }
    );
  }
}
