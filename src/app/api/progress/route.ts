import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { settings, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getSessionFromRequest } from "@/lib/authSession";
import { settingKey, MAIN_WORKSPACE } from "@/lib/workspace";

export const dynamic = "force-dynamic";

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

function normalizeRole(role: string): string {
  const r = (role || "").toLowerCase().replace(/-/g, "_").trim();
  if (r === "superadmin" || r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  if (r === "manager") return "manager";
  return "operator";
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

    const role = normalizeRole(session.role || "");
    const uname = String(session.username || "").toLowerCase();
    const allowed =
      role === "manager" ||
      role === "super_admin" ||
      uname === "manager" ||
      uname === "admin" ||
      uname === "superadmin";

    if (!allowed) {
      return NextResponse.json(
        { success: false, error: "Manager or admin only" },
        { status: 403 }
      );
    }

    const { dayKey, monthKey } = pstKeys();

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
    }[] = [];

    for (const u of userRows) {
      const r = normalizeRole(String(u.role || ""));
      const ws = String(u.workspace || "main").toLowerCase();
      const map = statsByWs[ws] || {};
      const st = map[String(u.id)] || map[String(u.username)] || {};
      let sentToday = Number(st.sentToday || 0) || 0;
      let sentMonth = Number(st.sentMonth || 0) || 0;
      const totalSent = Number(st.totalSent || 0) || 0;
      if (st.lastDate && st.lastDate !== dayKey) sentToday = 0;
      if (st.lastMonth && st.lastMonth !== monthKey) sentMonth = 0;

      people.push({
        id: Number(u.id),
        username: String(u.username),
        role: r,
        workspace: ws,
        sentToday,
        sentMonth,
        totalSent,
      });
    }

    people.sort((a, b) => {
      if (b.sentToday !== a.sentToday) return b.sentToday - a.sentToday;
      return a.username.localeCompare(b.username);
    });

    const totalToday = people.reduce((s, p) => s + (p.sentToday || 0), 0);
    const totalMonth = people.reduce((s, p) => s + (p.sentMonth || 0), 0);

    return NextResponse.json({
      success: true,
      timezone: "America/Los_Angeles",
      dayKey,
      monthKey,
      totalToday,
      totalMonth,
      people,
    });
  } catch (err: any) {
    console.error("progress GET:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed" },
      { status: 500 }
    );
  }
}
