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
      const perms =
        (await getJsonSetting(`permissions_${role}`, DEFAULT_BY_ROLE[role] || [])) ||
        DEFAULT_BY_ROLE[role] ||
        [];
      const statsMap = await getAgentStatsMap();
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
          permissions: perms,
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
      const all = await db.select().from(users).orderBy(desc(users.id));
      const statsMap = await getAgentStatsMap();
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
          permissions: DEFAULT_BY_ROLE[r] || DEFAULT_BY_ROLE.operator,
        };
      });
      const totalAllSent = list.reduce((s, u) => s + (u.totalSent || 0), 0);
      const totalToday = list.reduce((s, u) => s + (u.sentToday || 0), 0);
      return NextResponse.json({
        success: true,
        list,
        totals: {
          totalAllSent,
          totalToday,
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
      if (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$")) {
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

    if (action === "list_users") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }
      const all = await db.select().from(users).orderBy(desc(users.id));
      const statsMap = await getAgentStatsMap();
      const list = all.map((u) => {
        const st = statsMap[String(u.id)] || {};
        return {
          id: u.id,
          username: u.username,
          role: normalizeRole(u.role),
          totalSent: st.totalSent || 0,
          sentToday: st.sentToday || 0,
          dailyLimit: st.dailyLimit || 100,
        };
      });
      return NextResponse.json({ success: true, users: list });
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
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
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
      const hashedPassword = await bcrypt.hash(String(password), 10);

      const inserted = await db
        .insert(users)
        .values({
          username: String(username).trim(),
          passwordHash: hashedPassword,
          role: newRole,
        })
        .returning({ id: users.id });

      const newId = inserted[0]?.id;
      if (newId) {
        const statsMap = await getAgentStatsMap();
        statsMap[String(newId)] = {
          totalSent: 0,
          sentToday: 0,
          dailyLimit: Number(dailyLimit) || 100,
        };
        await setJsonSetting("agent_stats", statsMap);
      }
      return NextResponse.json({
        success: true,
        message: "User created",
        id: newId,
      });
    }

    if (action === "update_user") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
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
      if (dailyLimit !== undefined) {
        const statsMap = await getAgentStatsMap();
        const key = String(userId);
        statsMap[key] = {
          ...(statsMap[key] || {}),
          dailyLimit: Number(dailyLimit) || 100,
        };
        await setJsonSetting("agent_stats", statsMap);
      }
      return NextResponse.json({
        success: true,
        message: "User updated",
      });
    }

    if (action === "delete_user") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Only Super Admin" },
          { status: 403 }
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
          { success: false, error: "New password must be at least 4 characters" },
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
      const stored = found[0].passwordHash || "";
      let ok = false;
      if (stored.startsWith("$2")) {
        try {
          ok = await bcrypt.compare(String(currentPassword), stored);
        } catch {
          ok = false;
        }
      } else {
        ok = stored === String(currentPassword);
      }
      if (!ok) {
        return NextResponse.json(
          { success: false, error: "Current password incorrect" },
          { status: 400 }
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
      if (
        normalizeRole(session.role) === "operator" &&
        Number(userId) !== session.userId
      ) {
        return NextResponse.json(
          { success: false, error: "Forbidden" },
          { status: 403 }
        );
      }

      const statsMap = await getAgentStatsMap();
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
      await setJsonSetting("agent_stats", statsMap);
      return NextResponse.json({ success: true });
    }

    if (action === "get_permissions") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
      const role = body.role || myRole;
      const perms = await getJsonSetting(
        `permissions_${role}`,
        DEFAULT_BY_ROLE[role] || []
      );
      return NextResponse.json({ success: true, permissions: perms });
    }

    if (action === "set_permissions") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
      if (myRole !== "super_admin") {
        return NextResponse.json(
          { success: false, error: "Only Super Admin" },
          { status: 403 }
        );
      }
      const { role, permissions } = body;
      if (!role || !Array.isArray(permissions)) {
        return NextResponse.json(
          { success: false, error: "role and permissions required" },
          { status: 400 }
        );
      }
      await setJsonSetting(`permissions_${normalizeRole(role)}`, permissions);
      return NextResponse.json({ success: true, message: "Permissions saved" });
    }

    if (action === "get_smtp_assignments") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      const map = await getJsonSetting("smtp_assignments", {});
      return NextResponse.json({ success: true, map });
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
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
      if (myRole !== "super_admin") {
        return NextResponse.json(
          { success: false, error: "Only Super Admin can assign SMTP" },
          { status: 403 }
        );
      }
      const map = body.map && typeof body.map === "object" ? body.map : {};
      await setJsonSetting("smtp_assignments", map);
      return NextResponse.json({ success: true, message: "SMTP assignments saved" });
    }

    if (action === "forgot_password") {
      const { username, panel } = body;
      if (!username || !String(username).trim()) {
        return NextResponse.json(
          { success: false, error: "Username required" },
          { status: 400 }
        );
      }
      const uname = String(username).trim();
      const found = await db
        .select()
        .from(users)
        .where(eq(users.username, uname))
        .limit(1);

      const genericOk =
        "If this account exists, a recovery action was triggered. Contact Super Admin if needed.";

      if (!found.length) {
        return NextResponse.json({ success: true, message: genericOk });
      }

      const user = found[0];
      let role = normalizeRole(user.role);
      if (user.username === "superadmin" || user.username === "admin") {
        if (user.username === "superadmin") role = "super_admin";
      }
      if (normalizeRole(user.role) === "super_admin" || user.username === "superadmin") {
        role = "super_admin";
      }

      if (role === "super_admin" || user.username === "superadmin") {
        try {
          const accounts = await db
            .select()
            .from(gmailAccounts)
            .where(eq(gmailAccounts.status, "enabled"))
            .orderBy(desc(gmailAccounts.priority))
            .limit(1);
          if (!accounts.length) {
            return NextResponse.json(
              {
                success: false,
                error:
                  "No enabled SMTP account to send recovery email. Add one first.",
              },
              { status: 500 }
            );
          }
          const account = accounts[0];
          const transporter = nodemailer.createTransport({
            host: account.smtpHost || "smtp.gmail.com",
            port: Number(account.smtpPort) || 587,
            secure: Boolean(account.secure) || Number(account.smtpPort) === 465,
            auth: {
              user: smtpLoginUser(account),
              pass: account.appPassword || "",
            },
            tls: { rejectUnauthorized: false },
          });
          await transporter.sendMail({
            from: smtpFromAddress(account),
            to: SUPER_ADMIN_RECOVERY_EMAIL,
            subject: "[Email Automation] Super Admin password recovery request",
            text: `Forgot-password request for Super Admin: ${user.username}\n\nPassword is stored as a secure hash. Use Change Password in the dashboard after logging in.\n\nIf you did not request this, secure the dashboard immediately.`,
            html: `<p>Forgot-password request for Super Admin: <strong>${user.username}</strong></p><p>Password is stored as a secure hash. Use change password in the app.</p>`,
          });
        } catch (e: any) {
          console.error("Recovery email failed:", e);
          return NextResponse.json(
            { success: false, error: e.message || "Failed to send recovery email" },
            { status: 500 }
          );
        }
        return NextResponse.json({ success: true, message: genericOk });
      }

      const key = "password_reset_requests";
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);
      let list: any[] = [];
      if (existing.length) {
        try {
          list = JSON.parse(existing[0].value || "[]");
        } catch {
          list = [];
        }
      }
      list.push({
        id: Date.now(),
        userId: user.id,
        username: user.username,
        role: role,
        requestedAt: new Date().toISOString(),
        status: "pending",
        panel: panel || "",
      });
      if (existing.length) {
        await db
          .update(settings)
          .set({ value: JSON.stringify(list) })
          .where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value: JSON.stringify(list) });
      }
      return NextResponse.json({ success: true, message: genericOk });
    }

    if (action === "list_reset_requests") {
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
      const key = "password_reset_requests";
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);
      let list: any[] = [];
      if (existing.length) {
        try {
          list = JSON.parse(existing[0].value || "[]");
        } catch {
          list = [];
        }
      }
      return NextResponse.json({ success: true, list });
    }

    if (action === "resolve_reset") {
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
      const { requestId, userId, newPassword } = body;
      if (newPassword && userId) {
        const hashed = await bcrypt.hash(String(newPassword), 10);
        await db
          .update(users)
          .set({ passwordHash: hashed })
          .where(eq(users.id, Number(userId)));
      }
      if (requestId) {
        const key = "password_reset_requests";
        const existing = await db
          .select()
          .from(settings)
          .where(eq(settings.key, key))
          .limit(1);
        if (existing.length) {
          let list: any[] = [];
          try {
            list = JSON.parse(existing[0].value || "[]");
          } catch {
            list = [];
          }
          list = list.map((x) =>
            x.id === Number(requestId)
              ? { ...x, status: "resolved", resolvedAt: new Date().toISOString() }
              : x
          );
          await db
            .update(settings)
            .set({ value: JSON.stringify(list) })
            .where(eq(settings.key, key));
        }
      }
      return NextResponse.json({ success: true, message: "Resolved." });
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
