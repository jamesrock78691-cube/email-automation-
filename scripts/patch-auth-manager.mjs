#!/usr/bin/env node
/**
 * After restore-auth: PST day/month stats, manager role, seed manager user.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "api",
  "auth",
  "route.ts"
);

if (!fs.existsSync(FILE)) {
  console.log("patch-auth-manager: no auth file");
  process.exit(0);
}

let t = fs.readFileSync(FILE, "utf8");

if (!t.includes("function pstKeys")) {
  const helper = `
function pstKeys(d: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (ty: string) => parts.find((p) => p.type === ty)?.value || "00";
  const y = get("year");
  const m = get("month");
  const day = get("day");
  return { dayKey: \`\${y}-\${m}-\${day}\`, monthKey: \`\${y}-\${m}\` };
}

`;
  t = t.replace(
    "export async function GET(req: NextRequest) {",
    helper + "export async function GET(req: NextRequest) {"
  );
}

t = t.replace(
  /function normalizeRole\([^)]*\)[^{]*\{[\s\S]*?return "operator";\s*\}/,
  (block) => {
    if (block.includes('"manager"')) return block;
    return block.replace(
      'return "operator";',
      `if (r === "manager") return "manager";
  return "operator";`
    );
  }
);

const oldRecord = `      const today = new Date().toISOString().slice(0, 10);
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
      return NextResponse.json({ success: true });`;

const newRecord = `      const { dayKey, monthKey } = pstKeys();
      const cur = statsMap[key] || {
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
      cur.totalSent = (cur.totalSent || 0) + 1;
      cur.sentToday = (cur.sentToday || 0) + 1;
      cur.sentMonth = (cur.sentMonth || 0) + 1;
      if (session.username) cur.username = session.username;
      const count = Number(body.count || 1) || 1;
      if (count > 1) {
        cur.totalSent += count - 1;
        cur.sentToday += count - 1;
        cur.sentMonth += count - 1;
      }
      statsMap[key] = cur;
      await setAgentStatsMap(ws, statsMap);
      return NextResponse.json({
        success: true,
        stats: {
          sentToday: cur.sentToday,
          sentMonth: cur.sentMonth,
          totalSent: cur.totalSent,
          dailyLimit: cur.dailyLimit || 100,
          lastDate: cur.lastDate,
          lastMonth: cur.lastMonth,
        },
      });`;

if (t.includes(oldRecord)) {
  t = t.replace(oldRecord, newRecord);
  console.log("patch-auth-manager: record_send PST+month");
} else if (t.includes("sentMonth")) {
  console.log("patch-auth-manager: sentMonth already present");
} else {
  console.warn("patch-auth-manager: record_send pattern not found");
}

if (t.includes("for (const [username, role, workspace] of defaults)") && !t.includes('["manager"')) {
  t = t.replace(
    "for (const [username, role, workspace] of defaults)",
    `defaults.push(["manager", "manager", "main"] as any);
  for (const [username, role, workspace] of defaults)`
  );
  console.log("patch-auth-manager: seed manager in defaults");
}

if (!t.includes("ensureManagerUser")) {
  const ensureFn = `
async function ensureManagerUser() {
  try {
    const bcrypt = (await import("bcryptjs")).default;
    const { pool } = await import("@/db");
    const r = await pool.query(
      \`SELECT id FROM users WHERE lower(username) = 'manager' LIMIT 1\`
    );
    if (r.rows?.length) return;
    const hash = await bcrypt.hash("cubetech26", 10);
    await pool.query(
      \`INSERT INTO users (username, password_hash, role, workspace)
       VALUES ('manager', $1, 'manager', 'main')
       ON CONFLICT DO NOTHING\`,
      [hash]
    );
    console.log("[AUTH] created manager / cubetech26");
  } catch (e: any) {
    console.error("ensureManagerUser:", e?.message || e);
  }
}
`;
  t = t.replace(
    "export async function POST(req: NextRequest) {",
    ensureFn + "\nexport async function POST(req: NextRequest) {"
  );
  if (t.includes("await ensureSchemaReady()")) {
    t = t.replace(
      "await ensureSchemaReady();",
      "await ensureSchemaReady();\n    await ensureManagerUser();"
    );
  } else {
    t = t.replace(
      "const body = await req.json();",
      "await ensureManagerUser();\n    const body = await req.json();"
    );
  }
  console.log("patch-auth-manager: ensureManagerUser injected");
}

fs.writeFileSync(FILE, t);
console.log("patch-auth-manager: done", t.length);
