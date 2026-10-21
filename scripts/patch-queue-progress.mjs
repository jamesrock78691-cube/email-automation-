#!/usr/bin/env node
/** Bump agent_stats after successful auto process_next / process_batch. */
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

const helper = `
async function bumpAutoSendStats(
  session: { userId?: number; username?: string; workspace?: string },
  count = 1
) {
  try {
    if (!session?.userId && !session?.username) return;
    const { db } = await import("@/db");
    const { settings } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const { settingKey, MAIN_WORKSPACE } = await import("@/lib/workspace");
    const ws =
      String(session.workspace || MAIN_WORKSPACE).toLowerCase() || MAIN_WORKSPACE;
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
    if (String(cur.lastDate || "") !== dayKey) {
      cur.sentToday = 0;
      cur.lastDate = dayKey;
    }
    if (String(cur.lastMonth || "") !== monthKey) {
      cur.sentMonth = 0;
      cur.lastMonth = monthKey;
    }
    const n = Math.max(1, Number(count) || 1);
    cur.totalSent = (cur.totalSent || 0) + n;
    cur.sentToday = (cur.sentToday || 0) + n;
    cur.sentMonth = (cur.sentMonth || 0) + n;
    if (session.username) cur.username = session.username;
    if (session.username && String(session.userId) !== String(session.username)) {
      map[String(session.username)] = { ...cur };
    }
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
  if (t.includes("export async function POST")) {
    t = t.replace("export async function POST", helper + "\nexport async function POST");
    console.log("patch-queue-progress: helper injected");
  }
}

if (t.includes('if (action === "process_next")') && !t.includes("bumpAutoSendStats(session")) {
  t = t.replace(
    /if \(action === "process_next"\) \{\s*const result = await processNextQueueItem\([^)]*\);\s*return NextResponse\.json\(\{\s*success: true,\s*result,/,
    `if (action === "process_next") {
      const result = await processNextQueueItem(baseUrl, ws);
      if (result && (result as any).success) {
        await bumpAutoSendStats(
          { userId: (session as any).userId, username: session.username, workspace: ws },
          1
        );
      }
      return NextResponse.json({
        success: true,
        result,`
  );
  console.log("patch-queue-progress: process_next");
}

if (t.includes('if (action === "process_batch")') && !t.includes("bumpAutoSendStats(session, successCount)")) {
  t = t.replace(
    /return NextResponse\.json\(\{\s*success: true,\s*summary: `Processed \$\{results\.length\} items/,
    `if (successCount > 0) {
        await bumpAutoSendStats(
          { userId: (session as any).userId, username: session.username, workspace: ws },
          successCount
        );
      }
      return NextResponse.json({
        success: true,
        summary: \`Processed \${results.length} items`
  );
  console.log("patch-queue-progress: process_batch");
}

fs.writeFileSync(FILE, t);
console.log("patch-queue-progress: done", t.includes("bumpAutoSendStats"));
