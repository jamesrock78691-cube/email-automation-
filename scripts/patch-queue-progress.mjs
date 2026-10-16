#!/usr/bin/env node
/** After process_next success, bump agent_stats for the session user (auto sends). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "api",
  "queue",
  "route.ts"
);
if (!fs.existsSync(FILE)) {
  console.log("patch-queue-progress: skip");
  process.exit(0);
}
let t = fs.readFileSync(FILE, "utf8");
if (t.includes("bumpAutoSendStats")) {
  console.log("patch-queue-progress: already");
  process.exit(0);
}

const helper = `
async function bumpAutoSendStats(session: { userId?: number; username?: string; workspace?: string }, count = 1) {
  try {
    if (!session?.userId && !session?.username) return;
    const { db } = await import("@/db");
    const { settings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { settingKey, MAIN_WORKSPACE } = await import("@/lib/workspace");
    const ws = String(session.workspace || MAIN_WORKSPACE).toLowerCase() || MAIN_WORKSPACE;
    const key = settingKey("agent_stats", ws);
    const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    const map = rows.length ? JSON.parse(rows[0].value || "{}") : {};
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const get = (ty: string) => parts.find((p) => p.type === ty)?.value || "00";
    const dayKey = \`\${get("year")}-\${get("month")}-\${get("day")}\`;
    const monthKey = \`\${get("year")}-\${get("month")}\`;
    const id = String(session.userId || session.username);
    const cur = map[id] || {
      totalSent: 0,
      sentToday: 0,
      sentMonth: 0,
      dailyLimit: 100,
      lastDate: dayKey,
      lastMonth: monthKey,
      username: session.username || "",
    };
    if (cur.lastDate !== dayKey) {
      cur.sentToday = 0;
      cur.lastDate = dayKey;
    }
    if (cur.lastMonth !== monthKey) {
      cur.sentMonth = 0;
      cur.lastMonth = monthKey;
    }
    const n = Math.max(1, Number(count) || 1);
    cur.totalSent = (cur.totalSent || 0) + n;
    cur.sentToday = (cur.sentToday || 0) + n;
    cur.sentMonth = (cur.sentMonth || 0) + n;
    if (session.username) cur.username = session.username;
    map[id] = cur;
    const str = JSON.stringify(map);
    if (rows.length) await db.update(settings).set({ value: str }).where(eq(settings.key, key));
    else await db.insert(settings).values({ key, value: str });
  } catch (e) {
    console.error("bumpAutoSendStats:", e);
  }
}
`;

if (!t.includes("async function bumpAutoSendStats")) {
  t = t.replace(
    /export async function (GET|POST)/,
    helper + "\nexport async function $1"
  );
}

if (t.includes('if (action === "process_next")')) {
  t = t.replace(
    /if \(action === "process_next"\) \{[\s\S]*?const result = await processNextQueueItem\([^)]*\);/,
    (m) => {
      if (m.includes("bumpAutoSendStats")) return m;
      return m + `\n      if (result && (result as any).success) await bumpAutoSendStats(session, 1);`;
    }
  );
  console.log("patch-queue-progress: process_next");
}

if (t.includes('if (action === "process_batch")')) {
  if (!t.includes("bumpAutoSendStats(session")) {
    t = t.replace(
      /if \(action === "process_batch"\) \{/,
      `if (action === "process_batch") {\n      let __autoOk = 0;`
    );
    t = t.replace(
      /const res = await processNextQueueItem\([^)]*\);/g,
      (m) => m + `\n        if (res && (res as any).success) __autoOk++;`
    );
  }
}

fs.writeFileSync(FILE, t);
console.log("patch-queue-progress: done");
