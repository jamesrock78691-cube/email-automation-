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

async function loadJsonSetting(key: string, fallback: any = {}) {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!rows.length) return fallback;
    return JSON.parse(rows[0].value || JSON.stringify(fallback)) || fallback;
  } catch {
    return fallback;
  }
}

async function loadStatsMap(ws: string): Promise<Record<string, any>> {
  return loadJsonSetting(settingKey("agent_stats", ws), {});
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
    const parsed = JSON.parse(rows[0].value || "[]");
    if (!Array.isArray(parsed)) return null;
    return parsed
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

type QueueBucket = { today: number; month: number };

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
    const assignByWs: Record<string, Record<string, number[]>> = {};
    for (const ws of workspaces) {
      statsByWs[ws] = await loadStatsMap(ws);
      const raw = await loadJsonSetting(settingKey("smtp_assignments", ws), {});
      const map: Record<string, number[]> = {};
      if (raw && typeof raw === "object") {
        for (const [uid, ids] of Object.entries(raw)) {
          if (Array.isArray(ids)) {
            map[String(uid)] = ids
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n) && n > 0);
          }
        }
      }
      assignByWs[ws] = map;
    }

    const byGmail: Record<string, QueueBucket> = {};
    const byWorkspace: Record<string, QueueBucket> = {};
    let queueToday = 0;
    let queueMonth = 0;
    try {
      const q = await pool.query(
        `SELECT
           COALESCE(NULLIF(lower(workspace), ''), 'main') AS workspace,
           gmail_used_id,
           COUNT(*) FILTER (
             WHERE timezone('America/Los_Angeles', COALESCE(sent_at, created_at))::date
               = timezone('America/Los_Angeles', now())::date
           )::int AS today_cnt,
           COUNT(*) FILTER (
             WHERE date_trunc('month', timezone('America/Los_Angeles', COALESCE(sent_at, created_at)))
               = date_trunc('month', timezone('America/Los_Angeles', now()))
           )::int AS month_cnt
         FROM queue
         WHERE lower(COALESCE(status, '')) IN ('sent', 'done', 'success')
         GROUP BY 1, 2`
      );
      for (const row of q.rows || []) {
        const ws = String(row.workspace || "main").toLowerCase();
        const t = Number(row.today_cnt || 0) || 0;
        const m = Number(row.month_cnt || 0) || 0;
        queueToday += t;
        queueMonth += m;
        if (!byWorkspace[ws]) byWorkspace[ws] = { today: 0, month: 0 };
        byWorkspace[ws].today += t;
        byWorkspace[ws].month += m;
        if (row.gmail_used_id != null) {
          const gid = String(row.gmail_used_id);
          if (!byGmail[gid]) byGmail[gid] = { today: 0, month: 0 };
          byGmail[gid].today += t;
          byGmail[gid].month += m;
        }
      }
    } catch (e) {
      console.error("progress queue group:", e);
    }

    const gmailOwner: Record<string, number> = {};
    for (const ws of workspaces) {
      const map = assignByWs[ws] || {};
      for (const [uid, gids] of Object.entries(map)) {
        const userId = Number(uid);
        if (!Number.isFinite(userId)) continue;
        for (const gid of gids) {
          const key = String(gid);
          if (!gmailOwner[key]) gmailOwner[key] = userId;
        }
      }
    }

    const userQueue: Record<number, QueueBucket> = {};
    for (const [gid, bucket] of Object.entries(byGmail)) {
      const owner = gmailOwner[gid];
      if (owner) {
        if (!userQueue[owner]) userQueue[owner] = { today: 0, month: 0 };
        userQueue[owner].today += bucket.today;
        userQueue[owner].month += bucket.month;
      }
    }

    const usersByWs: Record<string, any[]> = {};
    for (const u of userRows) {
      const r = normalizeRole(String(u.role || ""));
      if (r === "manager") continue;
      const ws = String(u.workspace || "main").toLowerCase();
      if (!usersByWs[ws]) usersByWs[ws] = [];
      usersByWs[ws].push(u);
    }

    function pickPrimary(list: any[]): any | null {
      if (!list?.length) return null;
      const order = ["super_admin", "admin", "operator"];
      for (const role of order) {
        const hit = list.find(
          (u) => normalizeRole(String(u.role || "")) === role
        );
        if (hit) return hit;
      }
      return list[0];
    }

    for (const [ws, bucket] of Object.entries(byWorkspace)) {
      let attributedToday = 0;
      let attributedMonth = 0;
      for (const u of usersByWs[ws] || []) {
        const id = Number(u.id);
        const q = userQueue[id];
        if (q) {
          attributedToday += q.today;
          attributedMonth += q.month;
        }
      }
      const remToday = Math.max(0, bucket.today - attributedToday);
      const remMonth = Math.max(0, bucket.month - attributedMonth);
      if (remToday > 0 || remMonth > 0) {
        const primary = pickPrimary(usersByWs[ws] || []);
        if (primary) {
          const id = Number(primary.id);
          if (!userQueue[id]) userQueue[id] = { today: 0, month: 0 };
          userQueue[id].today += remToday;
          userQueue[id].month += remMonth;
        }
      }
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
      let totalSent = Number(st.totalSent || 0) || 0;
      if (st.lastDate && st.lastDate !== dayKey) sentToday = 0;
      if (st.lastMonth && st.lastMonth !== monthKey) sentMonth = 0;

      const id = Number(u.id);
      const q = userQueue[id];
      if (q) {
        if (q.today > sentToday) sentToday = q.today;
        if (q.month > sentMonth) sentMonth = q.month;
        if (q.month > totalSent) totalSent = q.month;
      }
      if (sentMonth < sentToday) sentMonth = sentToday;

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
      if (b.sentMonth !== a.sentMonth) return b.sentMonth - a.sentMonth;
      return a.username.localeCompare(b.username);
    });

    const forManager = isManager(session) && !isSuperAdmin(session);
    const shown = forManager
      ? people.filter((p) => p.visibleToManager)
      : people;

    let totalToday = shown.reduce((s, p) => s + (p.sentToday || 0), 0);
    let totalMonth = shown.reduce((s, p) => s + (p.sentMonth || 0), 0);

    if (queueToday > totalToday) totalToday = queueToday;
    if (queueMonth > totalMonth) totalMonth = queueMonth;
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
