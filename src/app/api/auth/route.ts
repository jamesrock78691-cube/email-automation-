import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, settings, gmailAccounts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
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

function createToken(user: { id: number; username: string; role: string; workspace?: string }) {
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

function verifyToken(token: string): {
  userId: number;
  username: string;
  role: string;
  workspace?: string;
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
  const authHeader = req.headers.get("authorization");
  const bearer =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
  const cookie = req.cookies.get("ea_session")?.value;
  const token = bearer || cookie;
  if (!token) return null;
  return verifyToken(token);
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
    await db.update(settings).set({ value: str }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value: str });
  }
}

async function getAgentStatsMap(ws: string = MAIN_WORKSPACE): Promise<Record<string, any>> {
  return getJsonSetting(settingKey("agent_stats", ws), {});
}

async function getPermissionsMap(ws: string = MAIN_WORKSPACE): Promise<Record<string, string[]>> {
  return getJsonSetting(settingKey("user_permissions", ws), {});
}

async function setAgentStatsMap(ws: string, value: any) {
  return setJsonSetting(settingKey("agent_stats", ws), value);
}

async function setPermissionsMap(ws: string, value: any) {
  return setJsonSetting(settingKey("user_permissions", ws), value);
}

function resolvePermissions(
  userId: number,
  role: string,
  permMap: Record<string, string[]>
): string[] {
  const r = normalizeRole(role);
  if (r === "super_admin") return [...ALL_PERMISSIONS];
  const byUser = permMap[String(userId)];
  if (Array.isArray(byUser) && byUser.length > 0) {
    return byUser.filter((p) =>
      (ALL_PERMISSIONS as readonly string[]).includes(p)
    );
  }
  return [...(DEFAULT_BY_ROLE[r] || DEFAULT_BY_ROLE.operator)];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || "me";

    if (action === "me") {
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
      const ws = resolveWorkspace(session.username, (session as any).workspace);
      const permMap = await getPermissionsMap(ws);
      const permissions = resolvePermissions(session.userId, role, permMap);
      const statsMap = await getAgentStatsMap(ws);
      const myStats = statsMap[String(session.userId)] || {
        totalSent: 0,
        sentToday: 0,
        dailyLimit: 100,
      };
      return NextResponse.json({
        success: true,
        user: {
          id: session.userId,
          username: session.username,
          role,
          workspace: ws,
          permissions,
          stats: myStats,
        },
        allPermissions: ALL_PERMISSIONS,
      });
    }

    if (action === "list_users") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") {
        myRole = "super_admin";
      }
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          { success: false, error: "Admin only" },
          { status: 403 }
        );
      }
      const ws = resolveWorkspace(session.username, (session as any).workspace);
      const allRaw = await db.select().from(users).orderBy(desc(users.id));
      const all = allRaw.filter((u) => resolveWorkspace(u.username, (u as any).workspace) === ws);
      const statsMap = await getAgentStatsMap(ws);
      const permMap = await getPermissionsMap(ws);
      const today = new Date().toISOString().slice(0, 10);
      const list = all.map((u) => {
        let r = normalizeRole(u.role);
        if (u.username === "admin" || u.username === "superadmin") r = "super_admin";
        const st = statsMap[String(u.id)] || {
          totalSent: 0,
          sentToday: 0,
          dailyLimit: 100,
        };
        if (st.lastSendDate && st.lastSendDate !== today) st.sentToday = 0;
        if (st.lastDate && st.lastDate !== today) st.sentToday = 0;
        return {
          id: u.id,
          username: u.username,
          role: r,
          totalSent: st.totalSent || 0,
          sentToday: st.sentToday || 0,
          dailyLimit: st.dailyLimit || 100,
          permissions: resolvePermissions(u.id, r, permMap),
        };
      });
      return NextResponse.json({
        success: true,
        list,
        totals: {
          totalAllSent: list.reduce((s, u) => s + (u.totalSent || 0), 0),
          totalToday: list.reduce((s, u) => s + (u.sentToday || 0), 0),
          agents: list.filter((u) => u.role === "operator").length,
        },
        allPermissions: ALL_PERMISSIONS,
      });
    }

    if (action === "permission_labels") {
      return NextResponse.json({
        success: true,
        allPermissions: ALL_PERMISSIONS,
        labels: {
          compose: "Compose Email",
          dashboard: "Live Queue & Run Panel",
          sheets: "Google Sheets Simulator",
          gmail: "Gmail & SMTP Rotators",
          templates: "HTML Templates Studio",
          campaigns: "Outreach Campaigns",
          admin_panel: "Admin Panel",
          smtp_view: "View SMTP Accounts",
          smtp_add: "Add SMTP Accounts",
          smtp_delete: "Delete SMTP Accounts",
          manage_users: "Manage Users / Agents",
        },
        defaults: DEFAULT_BY_ROLE,
      });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("Auth GET error:", err);
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

      const ws = resolveWorkspace(user.username, (user as any).workspace);
      const token = createToken({
        id: user.id,
        username: user.username,
        role,
        workspace: ws,
      });
      const permMap = await getPermissionsMap(ws);
      const permissions = resolvePermissions(user.id, role, permMap);
      const statsMap = await getAgentStatsMap(ws);
      const myStats = statsMap[String(user.id)] || {
        totalSent: 0,
        sentToday: 0,
        dailyLimit: 100,
      };
      const res = NextResponse.json({
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          role,
          workspace: ws,
          permissions,
          stats: myStats,
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

    if (action === "list_users") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin")
        myRole = "super_admin";
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
      const ws = resolveWorkspace(session.username, (session as any).workspace);
      const allRaw = await db.select().from(users).orderBy(desc(users.id));
      const all = allRaw.filter((u) => resolveWorkspace(u.username, (u as any).workspace) === ws);
      const statsMap = await getAgentStatsMap(ws);
      const permMap = await getPermissionsMap(ws);
      const list = all.map((u) => {
        const st = statsMap[String(u.id)] || {};
        return {
          id: u.id,
          username: u.username,
          role: normalizeRole(u.role),
          totalSent: st.totalSent || 0,
          sentToday: st.sentToday || 0,
          dailyLimit: st.dailyLimit || 100,
          permissions: resolvePermissions(u.id, normalizeRole(u.role), permMap),
        };
      });
      return NextResponse.json({ success: true, users: list, list });
    }

    if (action === "create_user") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin")
        myRole = "super_admin";
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
      const { username, password, role, dailyLimit } = body;
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: "Username and password required" },
          { status: 400 }
        );
      }
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.username, String(username).trim()))
        .limit(1);
      if (existing.length) {
        return NextResponse.json(
          { success: false, error: "Username already exists" },
          { status: 400 }
        );
      }
      let newRole = normalizeRole(role);
      if (myRole !== "super_admin" && newRole === "super_admin") {
        return NextResponse.json(
          { success: false, error: "Cannot create super admin" },
          { status: 403 }
        );
      }
      const ws = resolveWorkspace(session.username, (session as any).workspace);
      const hashedPassword = await bcrypt.hash(String(password), 10);
      const inserted = await db
        .insert(users)
        .values({
          username: String(username).trim(),
          passwordHash: hashedPassword,
          role: newRole,
          workspace: ws,
        } as any)
        .returning({ id: users.id });
      const newId = inserted[0]?.id;
      if (newId) {
        const statsMap = await getAgentStatsMap(ws);
        statsMap[String(newId)] = {
          totalSent: 0,
          sentToday: 0,
          dailyLimit: Number(dailyLimit) || 100,
        };
        await setAgentStatsMap(ws, statsMap);
        let perms: string[] = Array.isArray(body.permissions)
          ? body.permissions.filter((p: string) =>
              (ALL_PERMISSIONS as readonly string[]).includes(p)
            )
          : [];
        if (!perms.length) {
          perms = [...(DEFAULT_BY_ROLE[newRole] || DEFAULT_BY_ROLE.operator)];
        }
        if (newRole === "super_admin") perms = [...ALL_PERMISSIONS];
        const permMap = await getPermissionsMap(ws);
        permMap[String(newId)] = perms;
        await setPermissionsMap(ws, permMap);
      }
      return NextResponse.json({
        success: true,
        message: "User created",
        id: newId,
        role: newRole,
      });
    }

    if (action === "update_user" || action === "update_permissions") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin")
        myRole = "super_admin";
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
      const { userId, username, password: newPassword, role, dailyLimit } = body;
      if (!userId) {
        return NextResponse.json(
          { success: false, error: "userId required" },
          { status: 400 }
        );
      }
      const userUpdates: any = {};
      if (username) userUpdates.username = String(username).trim();
      if (role) {
        let newRole = normalizeRole(role);
        if (myRole !== "super_admin" && newRole === "super_admin") {
          return NextResponse.json(
            { success: false, error: "Cannot set super admin" },
            { status: 403 }
          );
        }
        userUpdates.role = newRole;
      }
      if (newPassword) {
        userUpdates.passwordHash = await bcrypt.hash(String(newPassword), 10);
      }
      if (Object.keys(userUpdates).length) {
        await db
          .update(users)
          .set(userUpdates)
          .where(eq(users.id, Number(userId)));
      }
      const wsUp = resolveWorkspace(session.username, (session as any).workspace);
      if (dailyLimit !== undefined && dailyLimit != null) {
        const statsMap = await getAgentStatsMap(wsUp);
        const key = String(userId);
        statsMap[key] = {
          ...(statsMap[key] || {}),
          dailyLimit: Number(dailyLimit) || 100,
        };
        await setAgentStatsMap(wsUp, statsMap);
      }
      if (Array.isArray(body.permissions)) {
        let perms = body.permissions.filter((p: string) =>
          (ALL_PERMISSIONS as readonly string[]).includes(p)
        );
        const permMap = await getPermissionsMap(wsUp);
        permMap[String(userId)] = perms;
        await setPermissionsMap(wsUp, permMap);
      }
      return NextResponse.json({ success: true, message: "User updated" });
    }

    if (action === "delete_user") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") {
        myRole = "super_admin";
      }
      if (myRole !== "super_admin") {
        return NextResponse.json(
          { success: false, error: "Only Super Admin" },
          { status: 403 }
        );
      }
      const { userId } = body;
      if (!userId) {
        return NextResponse.json(
          { success: false, error: "userId required" },
          { status: 400 }
        );
      }
      await db.delete(users).where(eq(users.id, Number(userId)));
      const wsDel = resolveWorkspace(session.username, (session as any).workspace);
      const permMap = await getPermissionsMap(wsDel);
      delete permMap[String(userId)];
      await setPermissionsMap(wsDel, permMap);
      return NextResponse.json({ success: true, message: "User deleted" });
    }

    if (action === "change_password") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      const { currentPassword, newPassword } = body;
      if (!currentPassword || !newPassword) {
        return NextResponse.json(
          { success: false, error: "Both passwords required" },
          { status: 400 }
        );
      }
      if (String(newPassword).length < 4) {
        return NextResponse.json(
          { success: false, error: "Password too short" },
          { status: 400 }
        );
      }
      const found = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (!found.length) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }
      const user = found[0];
      const stored = user.passwordHash || "";
      let ok = false;
      if (stored.startsWith("$2")) {
        ok = await bcrypt.compare(currentPassword, stored);
      } else {
        ok = stored === currentPassword;
      }
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Current password wrong" },
          { status: 401 }
        );
      }
      const hashed = await bcrypt.hash(String(newPassword), 10);
      await db
        .update(users)
        .set({ passwordHash: hashed })
        .where(eq(users.id, session.userId));
      return NextResponse.json({
        success: true,
        message: "Password updated",
      });
    }

    if (action === "record_send") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      const userId = body.userId || session.userId;
      const ws = resolveWorkspace(session.username, (session as any).workspace);
      const statsMap = await getAgentStatsMap(ws);
      const key = String(userId);
      const today = new Date().toISOString().slice(0, 10);
      const cur = statsMap[key] || {
        totalSent: 0,
        sentToday: 0,
        dailyLimit: 100,
        lastDate: today,
      };
      if (cur.lastDate !== today) {
        cur.sentToday = 0;
        cur.lastDate = today;
      }
      cur.totalSent = (cur.totalSent || 0) + 1;
      cur.sentToday = (cur.sentToday || 0) + 1;
      statsMap[key] = cur;
      await setAgentStatsMap(ws, statsMap);
      return NextResponse.json({ success: true });
    }

    if (action === "forgot_password") {
      return NextResponse.json({
        success: true,
        message: "If account exists, recovery instructions were sent",
      });
    }

    if (action === "set_smtp_assignments") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin")
        myRole = "super_admin";
      if (myRole !== "super_admin") {
        return NextResponse.json(
          { success: false, error: "Only Super Admin" },
          { status: 403 }
        );
      }
      const map = body.map && typeof body.map === "object" ? body.map : {};
      const wsSmtp = resolveWorkspace(session.username, (session as any).workspace);
      await setJsonSetting(settingKey("smtp_assignments", wsSmtp), map);
      return NextResponse.json({ success: true, message: "Saved" });
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
