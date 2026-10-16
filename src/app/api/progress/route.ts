import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { settings, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionFromRequest } from "@/lib/authSession";
import { settingKey, MAIN_WORKSPACE } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const VISIBLE_KEY = "manager_visible_users";

function pstKeys(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const y = get("year");
  const m = get("month");
  const day = get("day");
  return { dayKey: `${y}-${m}-${day}`, monthKey: `${y}-${m}` };
}

async function loadStatsMap(ws: string): Promise<Record<string, any>> {
  try {
    const key = settingKey("agent_stats", ws);
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!rows.length) return {};
    return JSON.parse(rows[0].value || "{}") || {};
  } catch {
    return {};
  }
}

async function loadVisibleIds(): Promise<number[] | null> {
  try {
    const key = settingKey(VISIBLE_KEY, MAIN_WORKSPACE);
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!rows.length) return null;
    const arr = JSON.parse(rows[0].value || "[]");
    if (!Array.isArray(arr)) return null;
    return arr
      .map((x: any) => Number(x))
      .filter((n: number) => Number.isFinite(n) && n > 0);
  } catch {
    return null;
  }
}

async function saveVisibleIds(ids: number[]) {
  const key = settingKey(VISIBLE_KEY, MAIN_WORKSPACE);
  const str = JSON.stringify(ids);
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

function normalizeRole(role: string): string {
  const r = (role || "").toLowerCase().replace(/-/g, "_").trim();
  if (r === "superadmin" || r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  if (r === "manager") return "manager";
  return "operator";
}

function isSuperAdmin(session: { role?: string; username?: string }) {
  const role = normalizeRole(session.role || "");
  const uname = String(session.username || "").toLowerCase();
  return role === "super_admin" || uname === "admin" || uname === "superadmin";
}

function isManager(session: { role?: string; username?: string }) {
  const role = normalizeRole(session.role || "");
  const uname = String(session.username || "").toLowerCase();
  return role === "manager" || uname === "manager";
}

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }

    if (!isManager(session) && !isSuperAdmin(session)) {
      return NextResponse.json(
        { success: false, error: "Manager or admin only" },
        { status: 403 }
      );
    }

    const { dayKey, monthKey } = pstKeys();
    const visibleIds = await loadVisibleIds();

    let userRows: any[] = [];
    try {
      const r = await pool.query(
        `SELECT id, username, role, COALESCE(workspace, 'main') AS workspace
         FROM users ORDER BY lower(username)`
      );
      userRows = r.rows || [];
    } catch (e) {
      console.error("progress users query:", e);
      userRows = await db.select().from(users);
    }

    const workspaces = Array.from(
      new Set(
        userRows
          .map((u) => String(u.workspace || "main").toLowerCase())
          .concat([MAIN_WORKSPACE, "main", "sandeer", "amazon"])
      )
    );

    const statsByWs: Record<string, Record<string, any>> = {};
    for (const ws of workspaces) {
      statsByWs[ws] = await loadStatsMap(ws);
    }

    const people: {
      id: number;
      username: string;
      role: string;
      workspace: string;
      sentToday: number;
      sentMonth: number;
      totalSent: number;
      visibleToManager: boolean;
    }[] = [];

    for (const u of userRows) {
      const r = normalizeRole(String(u.role || ""));
      if (r === "manager") continue;

      const ws = String(u.workspace || "main").toLowerCase();
      const map = statsByWs[ws] || {};
      const st = map[String(u.id)] || map[String(u.username)] || {};
      let sentToday = Number(st.sentToday || 0) || 0;
      let sentMonth = Number(st.sentMonth || 0) || 0;
      const totalSent = Number(st.totalSent || 0) || 0;
      if (st.lastDate && st.lastDate !== dayKey) sentToday = 0;
      if (st.lastMonth && st.lastMonth !== monthKey) sentMonth = 0;
      if (
        (!st.lastDate || st.lastDate === dayKey) &&
        (!st.lastMonth || st.lastMonth === monthKey) &&
        sentMonth < sentToday
      ) {
        sentMonth = sentToday;
      }

      const id = Number(u.id);
      const visibleToManager =
        visibleIds === null ? true : visibleIds.includes(id);

      people.push({
        id,
        username: String(u.username),
        role: r,
        workspace: ws,
        sentToday,
        sentMonth,
        totalSent,
        visibleToManager,
      });
    }

    people.sort((a, b) => {
      if (b.sentToday !== a.sentToday) return b.sentToday - a.sentToday;
      return a.username.localeCompare(b.username);
    });

    const forManager = isManager(session) && !isSuperAdmin(session);
    const shown = forManager
      ? people.filter((p) => p.visibleToManager)
      : people;

    // Agent-stats sum (after system was built)
    let totalToday = shown.reduce((s, p) => s + (p.sentToday || 0), 0);
    let totalMonth = shown.reduce((s, p) => s + (p.sentMonth || 0), 0);

    // Queue is source of truth for historical sends (before progress system + auto + manual)
    try {
      const q = await pool.query(
        `SELECT
           COUNT(*) FILTER (
             WHERE timezone('America/Los_Angeles', COALESCE(sent_at, created_at))::date
               = timezone('America/Los_Angeles', now())::date
           )::int AS today_cnt,
           COUNT(*) FILTER (
             WHERE date_trunc('month', timezone('America/Los_Angeles', COALESCE(sent_at, created_at)))
               = date_trunc('month', timezone('America/Los_Angeles', now()))
           )::int AS month_cnt
         FROM queue
         WHERE lower(COALESCE(status, '')) IN ('sent', 'done', 'success')`
      );
      const row = q.rows?.[0];
      if (row) {
        const qt = Number(row.today_cnt || 0) || 0;
        const qm = Number(row.month_cnt || 0) || 0;
        if (qt > totalToday) totalToday = qt;
        if (qm > totalMonth) totalMonth = qm;
      }
    } catch (e) {
      console.error("progress queue totals:", e);
    }

    if (totalMonth < totalToday) totalMonth = totalToday;

    return NextResponse.json({
      success: true,
      timezone: "America/Los_Angeles",
      dayKey,
      monthKey,
      totalToday,
      totalMonth,
      people: shown,
      allPeople: isSuperAdmin(session) ? people : undefined,
      visibleUserIds: isSuperAdmin(session)
        ? visibleIds === null
          ? people.map((p) => p.id)
          : visibleIds
        : undefined,
      visibilityConfigured: visibleIds !== null,
    });
  } catch (err: any) {
    console.error("progress GET:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (!isSuperAdmin(session)) {
      return NextResponse.json(
        { success: false, error: "Super admin only" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "set_visible");

    if (action === "set_visible") {
      const raw = body.userIds ?? body.visibleUserIds ?? [];
      if (!Array.isArray(raw)) {
        return NextResponse.json(
          { success: false, error: "userIds must be an array" },
          { status: 400 }
        );
      }
      const ids = Array.from(
        new Set(
          raw
            .map((x: any) => Number(x))
            .filter((n: number) => Number.isFinite(n) && n > 0)
        )
      );
      await saveVisibleIds(ids);
      return NextResponse.json({ success: true, visibleUserIds: ids });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action" },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("progress POST:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed" },
      { status: 500 }
    );
  }
}
