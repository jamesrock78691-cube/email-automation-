import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, settings, gmailAccounts } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import nodemailer from "nodemailer";
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
    if (!token || !token.includes(".")) return null;
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const expected = sign(payloadB64);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const payload = JSON.parse(json);
    if (!payload?.userId || !payload?.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return req.cookies.get("ea_session")?.value || null;
}

function getSession(req: NextRequest) {
  const token = getToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  return { token, ...payload };
}

function normalizeRole(role: string | null | undefined) {
  const r = (role || "operator").toLowerCase().trim();
  if (r === "super_admin" || r === "superadmin" || r === "super admin")
    return "super_admin";
  if (r === "admin") return "admin";
  return "operator";
}

async function getJsonSetting(key: string): Promise<any> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!rows.length) return {};
    return JSON.parse(rows[0].value || "{}");
  } catch {
    return {};
  }
}

async function setJsonSetting(key: string, value: any) {
  const str = JSON.stringify(value);
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  if (rows.length) {
    await db.update(settings).set({ value: str }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value: str });
  }
}

async function getPermissionsMap(): Promise<Record<string, string[]>> {
  return (await getJsonSetting("user_permissions")) || {};
}

async function getAgentStatsMap(): Promise<
  Record<
    string,
    {
      totalSent: number;
      sentToday: number;
      dailyLimit: number;
      lastSendDate?: string;
    }
  >
> {
  return (await getJsonSetting("agent_stats")) || {};
}

function resolvePermissions(
  userId: number,
  role: string,
  permMap: Record<string, string[]>
): string[] {
  const r = normalizeRole(role);
  if (r === "super_admin") return [...ALL_PERMISSIONS];
  const custom = permMap[String(userId)];
  if (custom && Array.isArray(custom) && custom.length > 0) return custom;
  return DEFAULT_BY_ROLE[r] || DEFAULT_BY_ROLE.operator;
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
      const found = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);

      if (!found.length) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 401 }
        );
      }

      let role = normalizeRole(found[0].role);
      if (
        found[0].username === "admin" ||
        found[0].username === "superadmin" ||
        found[0].role === "super_admin"
      ) {
        role = "super_admin";
        if (found[0].role !== "super_admin") {
          try {
            await db
              .update(users)
              .set({ role: "super_admin" })
              .where(eq(users.id, found[0].id));
          } catch {}
        }
      }

      const permMap = await getPermissionsMap();
      const permissions = resolvePermissions(found[0].id, role, permMap);

      const statsMap = await getAgentStatsMap();
      const today = new Date().toISOString().slice(0, 10);
      const myStats = statsMap[String(found[0].id)] || {
        totalSent: 0,
        sentToday: 0,
        dailyLimit: 100,
      };
      if (myStats.lastSendDate && myStats.lastSendDate !== today) {
        myStats.sentToday = 0;
      }

      return NextResponse.json({
        success: true,
        user: {
          id: found[0].id,
          username: found[0].username,
          role,
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
      const role = normalizeRole(session.role);
      if (role !== "super_admin" && role !== "admin") {
        return NextResponse.json(
          { success: false, error: "Admin only" },
          { status: 403 }
        );
      }

      const list = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          createdAt: users.createdAt,
        })
        .from(users);

      const permMap = await getPermissionsMap();
      const statsMap = await getAgentStatsMap();
      const today = new Date().toISOString().slice(0, 10);

      const enriched = list.map((u) => {
        let r = normalizeRole(u.role);
        if (
          (u.username === "admin" || u.username === "superadmin") &&
          u.role === "admin"
        ) {
          r = "super_admin";
        }
        const st = statsMap[String(u.id)] || {
          totalSent: 0,
          sentToday: 0,
          dailyLimit: 100,
        };
        if (st.lastSendDate && st.lastSendDate !== today) st.sentToday = 0;
        return {
          ...u,
          role: r,
          permissions: resolvePermissions(u.id, r, permMap),
          totalSent: st.totalSent || 0,
          sentToday: st.sentToday || 0,
          dailyLimit: st.dailyLimit || 100,
        };
      });

      const totalAllSent = enriched.reduce((s, u) => s + (u.totalSent || 0), 0);
      const totalToday = enriched.reduce((s, u) => s + (u.sentToday || 0), 0);

      return NextResponse.json({
        success: true,
        list: enriched,
        totals: {
          totalAllSent,
          totalToday,
          agents: enriched.filter((u) => u.role === "operator").length,
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
    const action = body.action || "login";

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
    if (user.role !== "super_admin") {
      try {
        await db
          .update(users)
          .set({ role: "super_admin" })
          .where(eq(users.id, user.id));
      } catch {}
    }
  }

  // Panel restriction
  const panel = body.panel || "admin";
  if (panel === "operator" && role !== "operator") {
    return NextResponse.json(
      {
        success: false,
        error: "This panel is for Operators only. Use Admin / Super Admin login.",
      },
      { status: 403 }
    );
  }
  if (panel === "admin" && role === "operator") {
    return NextResponse.json(
      {
        success: false,
        error: "Operators must use the Operator login panel.",
      },
      { status: 403 }
    );
  }

  const token = createToken({
    id: user.id,
    username: user.username,
    role,
  });

  const permMap = await getPermissionsMap();
  const permissions = resolvePermissions(user.id, role, permMap);
  const statsMap = await getAgentStatsMap();
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
      permissions,
      stats: myStats,
    },
  });
  res.cookies.set("ea_session", token, {
    httpOnly: true,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
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

    if (action === "create_user") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      const myRole = normalizeRole(session.role);
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          { success: false, error: "Admin only" },
          { status: 403 }
        );
      }

      const { username, password, role, dailyLimit, permissions } = body;
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: "Username and password required" },
          { status: 400 }
        );
      }

      let newRole = normalizeRole(role || "operator");

      if (myRole === "admin") {
        if (newRole !== "operator") {
          return NextResponse.json(
            {
              success: false,
              error: "Admin can only create operator accounts",
            },
            { status: 403 }
          );
        }
        newRole = "operator";
      }

      // Never allow creating another Super Admin via panel
      if (newRole === "super_admin") {
        return NextResponse.json(
          { success: false, error: "Cannot create Super Admin from panel" },
          { status: 403 }
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

        // Save custom permissions if provided (super_admin only for full control)
        if (Array.isArray(permissions) && permissions.length > 0) {
          if (myRole === "super_admin" || myRole === "admin") {
            let perms = permissions.filter((p: string) =>
              (ALL_PERMISSIONS as readonly string[]).includes(p)
            );
            // Admin can ONLY grant compose + templates
            if (myRole === "admin") {
              perms = perms.filter((p: string) =>
                ["compose", "templates"].includes(p)
              );
              if (perms.length === 0) perms = ["compose", "templates"];
            }
            const permMap = await getPermissionsMap();
            permMap[String(newId)] = perms;
            await setJsonSetting("user_permissions", permMap);
          }
        } else {
          // apply role defaults explicitly
          const permMap = await getPermissionsMap();
          permMap[String(newId)] = DEFAULT_BY_ROLE[newRole] || DEFAULT_BY_ROLE.operator;
          await setJsonSetting("user_permissions", permMap);
        }
      }

      return NextResponse.json({
        success: true,
        message: "User created",
        role: newRole,
        id: newId,
      });
    }

    if (action === "update_permissions") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      let myRole = normalizeRole(session.role);
      // Treat username admin as super_admin
      try {
        const me = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
        if (me[0] && (me[0].username === "admin" || me[0].username === "superadmin")) {
          myRole = "super_admin";
        }
      } catch {}
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          {
            success: false,
            error: "Only Super Admin / Admin can edit permissions",
          },
          { status: 403 }
        );
      }

      const { userId, permissions, dailyLimit, role } = body;
      if (!userId) {
        return NextResponse.json(
          { success: false, error: "userId required" },
          { status: 400 }
        );
      }

      const target = await db
        .select()
        .from(users)
        .where(eq(users.id, Number(userId)))
        .limit(1);
      if (!target.length) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }

      // Admin can only edit operators
      const targetRoleCheck = normalizeRole(target[0].role);
      if (myRole === "admin" && targetRoleCheck !== "operator") {
        return NextResponse.json(
          { success: false, error: "Admin can only edit operators" },
          { status: 403 }
        );
      }

      if (Array.isArray(permissions)) {
        let perms = permissions.filter((p: string) =>
          (ALL_PERMISSIONS as readonly string[]).includes(p)
        );
        const targetRole = role
          ? normalizeRole(role)
          : normalizeRole(target[0].role);
        if (targetRole === "super_admin") {
          perms = [...ALL_PERMISSIONS];
        }
        if (myRole === "admin") {
          // admin cannot grant smtp_delete or make super
          perms = perms.filter((p) => p !== "smtp_delete");
        }
        const permMap = await getPermissionsMap();
        permMap[String(userId)] = perms;
        await setJsonSetting("user_permissions", permMap);
      }

      if (role) {
        const newRole = normalizeRole(role);
        if (newRole !== "super_admin" || myRole === "super_admin") {
          await db
            .update(users)
            .set({ role: newRole })
            .where(eq(users.id, Number(userId)));
        }
      }

      if (dailyLimit != null) {
        const statsMap = await getAgentStatsMap();
        const key = String(userId);
        statsMap[key] = {
          totalSent: statsMap[key]?.totalSent || 0,
          sentToday: statsMap[key]?.sentToday || 0,
          dailyLimit: Number(dailyLimit) || 100,
          lastSendDate: statsMap[key]?.lastSendDate,
        };
        await setJsonSetting("agent_stats", statsMap);
      }

      // Username / password update (edit user)
      const { username, newPassword } = body;
      const userUpdates: any = {};
      if (username && String(username).trim()) {
        const uname = String(username).trim();
        const clash = await db
          .select()
          .from(users)
          .where(eq(users.username, uname))
          .limit(1);
        if (clash.length && clash[0].id !== Number(userId)) {
          return NextResponse.json(
            { success: false, error: "Username already taken" },
            { status: 400 }
          );
        }
        userUpdates.username = uname;
      }
            if (newPassword && String(newPassword).length > 0) {
  userUpdates.passwordHash = await bcrypt.hash(String(newPassword), 10);
}
      if (Object.keys(userUpdates).length) {
        await db
          .update(users)
          .set(userUpdates)
          .where(eq(users.id, Number(userId)));
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
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      const myRole = normalizeRole(session.role);
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json(
          { success: false, error: "Admin only" },
          { status: 403 }
        );
      }

      const { id } = body;
      if (!id) {
        return NextResponse.json(
          { success: false, error: "id required" },
          { status: 400 }
        );
      }
      if (Number(id) === session.userId) {
        return NextResponse.json(
          { success: false, error: "Cannot delete yourself" },
          { status: 400 }
        );
      }

      const target = await db
        .select()
        .from(users)
        .where(eq(users.id, Number(id)))
        .limit(1);
      if (!target.length) {
        return NextResponse.json(
          { success: false, error: "User not found" },
          { status: 404 }
        );
      }

      const targetRole = normalizeRole(target[0].role);
      if (myRole === "admin" && targetRole !== "operator") {
        return NextResponse.json(
          { success: false, error: "Admin can only delete operators" },
          { status: 403 }
        );
      }
      if (targetRole === "super_admin" && myRole !== "super_admin") {
        return NextResponse.json(
          { success: false, error: "Cannot delete Super Admin" },
          { status: 403 }
        );
      }

      await db.delete(users).where(eq(users.id, Number(id)));
      const permMap = await getPermissionsMap();
      delete permMap[String(id)];
      await setJsonSetting("user_permissions", permMap);

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
      const found = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (!found.length || found[0].passwordHash !== currentPassword) {
        return NextResponse.json(
          { success: false, error: "Current password incorrect" },
          { status: 400 }
        );
      }
      await db
        .update(users)
        .set({ passwordHash: newPassword })
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
      };
      if (cur.lastSendDate && cur.lastSendDate !== today) {
        cur.sentToday = 0;
      }
      if (cur.sentToday >= (cur.dailyLimit || 100)) {
        return NextResponse.json(
          {
            success: false,
            error: `Daily limit reached (${cur.dailyLimit})`,
            stats: cur,
          },
          { status: 429 }
        );
      }
      cur.sentToday = (cur.sentToday || 0) + 1;
      cur.totalSent = (cur.totalSent || 0) + 1;
      cur.lastSendDate = today;
      statsMap[key] = cur;
      await setJsonSetting("agent_stats", statsMap);
      return NextResponse.json({ success: true, stats: cur });
    }

    // ─── SMTP user assignments ───
    if (action === "get_smtp_assignments") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
      }
      const map = (await getJsonSetting("smtp_assignments")) || {};
      return NextResponse.json({ success: true, map });
    }

    if (action === "set_smtp_assignments") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
      if (myRole !== "super_admin") {
        return NextResponse.json({ success: false, error: "Only Super Admin can assign SMTP" }, { status: 403 });
      }
      const map = body.map && typeof body.map === "object" ? body.map : {};
      await setJsonSetting("smtp_assignments", map);
      return NextResponse.json({ success: true, message: "SMTP assignments saved" });
    }

    // ─── FORGOT PASSWORD (no more admin123 hard reset) ───
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
        // admin username is treated as super_admin in this app
        if (user.username === "superadmin") role = "super_admin";
      }
      // Prefer explicit super_admin role
      if (normalizeRole(user.role) === "super_admin" || user.username === "superadmin") {
        role = "super_admin";
      }

      // SUPER ADMIN → email current password to jamesrock78691@gmail.com
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
            host: account.smtpHost,
            port: Number(account.smtpPort),
            secure: Boolean(account.secure),
            auth: { user: account.email, pass: account.appPassword },
            tls: { rejectUnauthorized: false },
          });
          await transporter.sendMail({
            from: `"Email Automation Dashboard" <${account.email}>`,
            to: SUPER_ADMIN_RECOVERY_EMAIL,
            subject: `Super Admin Password Recovery — ${user.username}`,
            text: `Forgot-password request for Super Admin: ${user.username}\n\nCurrent password: ${user.passwordHash}\n\nIf you did not request this, secure the dashboard immediately.`,
            html: `<p>Forgot-password request for Super Admin: <code>${user.username}</code></p>
<p><strong>Current password:</strong> <code style="background:#f1f5f9;padding:4px 8px;border-radius:4px;">${user.passwordHash}</code></p>
<p style="color:#64748b;font-size:13px;">If you did not request this, secure the dashboard immediately.</p>`,
          });
          return NextResponse.json({
            success: true,
            message: `Current password emailed to ${SUPER_ADMIN_RECOVERY_EMAIL}. Check that inbox.`,
          });
        } catch (mailErr: any) {
          return NextResponse.json(
            {
              success: false,
              error:
                mailErr?.message ||
                "Failed to send recovery email. Check SMTP config.",
            },
            { status: 500 }
          );
        }
      }

      // ADMIN / OPERATOR → notification for Super Admin (stored in settings)
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
      list.unshift({
        id: Date.now(),
        userId: user.id,
        username: user.username,
        role: normalizeRole(user.role),
        panel: panel || "unknown",
        status: "pending",
        message: `Password reset requested from ${panel || "unknown"} panel.`,
        createdAt: new Date().toISOString(),
      });
      list = list.slice(0, 50);
      if (existing.length) {
        await db
          .update(settings)
          .set({ value: JSON.stringify(list) })
          .where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({
          key,
          value: JSON.stringify(list),
        });
      }
      return NextResponse.json({
        success: true,
        message:
          "Notification sent to Super Admin. They will reset your password. No automatic reset.",
      });
    }

    // Super Admin: list pending forgot-password requests
    if (action === "list_reset_requests") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
      }
      let myRole = normalizeRole(session.role);
      if (session.username === "admin" || session.username === "superadmin") myRole = "super_admin";
      if (myRole !== "super_admin" && myRole !== "admin") {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
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
      return NextResponse.json({
        success: true,
        list: list.filter((x) => x.status === "pending"),
      });
    }

    // Super Admin: resolve + set new password for user
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
        await db
          .update(users)
          .set({ passwordHash: String(newPassword) })
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
