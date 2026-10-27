#!/usr/bin/env node
/**
 * After restore-auth: PST day/month stats, manager role, seed manager user.
 * Safe normalizeRole replace (must not break const r declaration).
 * Also injects get_smtp_assignments action.
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

const GOOD_NORM = `function normalizeRole(role: string | null | undefined): string {
  if (!role) return "operator";
  const r = String(role).toLowerCase().replace(/-/g, "_");
  if (r === "superadmin" || r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  if (r === "manager") return "manager";
  return "operator";
}`;

const NORM_RE = /function normalizeRole\([^)]*\)[^{]*\{[\s\S]*?\n\}/;

if (NORM_RE.test(t)) {
  t = t.replace(NORM_RE, GOOD_NORM);
  console.log("patch-auth-manager: normalizeRole set (manager support)");
} else {
  console.warn("patch-auth-manager: normalizeRole not found");
}

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
  if (t.includes("export async function GET(req: NextRequest) {")) {
    t = t.replace(
      "export async function GET(req: NextRequest) {",
      helper + "export async function GET(req: NextRequest) {"
    );
  } else {
    t = t.replace(
      "export async function POST(req: NextRequest) {",
      helper + "export async function POST(req: NextRequest) {"
    );
  }
  console.log("patch-auth-manager: pstKeys added");
}

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
} else if (t.includes("sentMonth") && t.includes("pstKeys()")) {
  console.log("patch-auth-manager: sentMonth already present");
} else {
  console.warn("patch-auth-manager: record_send pattern not found");
}

if (
  t.includes("for (const [username, role, workspace] of defaults)") &&
  !t.includes('["manager"')
) {
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
  } else if (t.includes("const body = await req.json();")) {
    t = t.replace(
      "const body = await req.json();",
      "await ensureManagerUser();\n    const body = await req.json();"
    );
  }
  console.log("patch-auth-manager: ensureManagerUser injected");
}

if (t.includes('if (!role) if (r === "manager")') || /const r = String\(role\)[\s\S]*if \(!role\) if \(r/.test(t)) {
  t = t.replace(NORM_RE, GOOD_NORM);
  console.log("patch-auth-manager: forced normalizeRole repair");
}

if (!t.includes('if (r === "manager") return "manager"')) {
  console.error("patch-auth-manager: FATAL normalizeRole missing manager");
  process.exit(1);
}

// ---- get_smtp_assignments (accountId→userIds map, same as UI) ----
if (!t.includes('action === "get_smtp_assignments"')) {
  const getBlock = `
    if (action === "get_smtp_assignments") {
      const session = getSession(req);
      if (!session) {
        return NextResponse.json(
          { success: false, error: "Not authenticated" },
          { status: 401 }
        );
      }
      const wsSmtp = resolveWorkspace(session.username, (session as any).workspace);
      const map = await getJsonSetting(settingKey("smtp_assignments", wsSmtp), {});
      return NextResponse.json({ success: true, map: map || {} });
    }

`;
  const anchor = 'if (action === "set_smtp_assignments")';
  if (t.includes(anchor)) {
    t = t.replace(anchor, getBlock + anchor);
    console.log("patch-auth-manager: get_smtp_assignments added");
  } else {
    const unk =
      'return NextResponse.json(\n      { success: false, error: "Unknown action" }';
    if (t.includes(unk)) {
      t = t.replace(unk, getBlock + unk);
      console.log("patch-auth-manager: get_smtp_assignments before unknown");
    } else {
      console.warn("patch-auth-manager: could not insert get_smtp_assignments");
    }
  }
}

fs.writeFileSync(FILE, t);
console.log("patch-auth-manager: done", t.length);
