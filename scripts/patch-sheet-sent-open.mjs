#!/usr/bin/env node
/**
 * Reliable sheet Sent + Open Count (admin/sandeer/amazon)
 * and pixel open_count via pool (unique opens).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sheetsPath = path.join(root, "src/app/services/googleSheets.ts");
const senderPath = path.join(root, "src/app/services/emailSender.ts");
const trackPath = path.join(root, "src/app/api/track/[trackingId]/route.ts");
const dashPath = path.join(root, "src/app/api/dashboard/route.ts");

const HELPERS = `
function normSheet(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

async function findAutoSheetDataRow(
  ws: string | null | undefined,
  match: {
    trackingId?: string;
    email?: string;
    serialNo?: string;
    referenceNo?: string;
    sheetRow?: number | null;
  }
): Promise<{ rowNumber: number; openCount: number } | null> {
  const sheet = await getAutoSheet(ws, { refresh: true });
  await sheet.loadHeaderRow();
  const headers: string[] = (sheet.headerValues || []).map((h: any) => String(h || ""));
  if (!headers.length) return null;

  const cols = {
    trackingId: headerIndex(headers, "Tracking ID", "tracking_id", "Tracking Id", "tracking id", "TrackingID"),
    email: headerIndex(headers, "Email", "email", "E-mail", "email address"),
    serial: headerIndex(headers, "serial_no", "Serial No", "Serial", "serial"),
    reference: headerIndex(headers, "reference_no", "Reference No", "Reference", "ref"),
    openCount: headerIndex(headers, "Open Count", "open_count", "OpenCount", "opens"),
  };

  const directRow = Number(match.sheetRow || 0);
  if (directRow > 1) {
    return { rowNumber: directRow, openCount: 0 };
  }

  const lastCol = Math.max(0, headers.length - 1);
  const maxRow = Math.min(Math.max(sheet.rowCount || 2, 2), 3000);
  let grid: any[][] = [];
  try {
    const range = \`A2:\${colLetter(lastCol)}\${maxRow}\`;
    grid = ((await sheet.getCellsInRange(range)) as any[][]) || [];
  } catch (err) {
    console.error("[SHEET FIND] range failed", ws, err);
    return null;
  }

  const wantTid = normSheet(match.trackingId);
  const wantEmail = normSheet(match.email);
  const wantSerial = normSheet(match.serialNo);
  const wantRef = normSheet(match.referenceNo);
  let fallback: { rowNumber: number; openCount: number } | null = null;

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] || [];
    const cell = (idx: number) => (idx >= 0 ? String(row[idx] ?? "").trim() : "");
    const tid = normSheet(cell(cols.trackingId));
    const email = normSheet(cell(cols.email));
    const serial = normSheet(cell(cols.serial));
    const ref = normSheet(cell(cols.reference));
    const ocRaw = parseInt(cell(cols.openCount) || "0", 10);
    const openCount = Number.isFinite(ocRaw) ? ocRaw : 0;
    const rowNumber = i + 2;
    if (wantTid && tid && tid === wantTid) return { rowNumber, openCount };
    if (!fallback && wantSerial && serial && serial === wantSerial) {
      fallback = { rowNumber, openCount };
    }
    if (!fallback && wantEmail && email && email === wantEmail && wantSerial && serial === wantSerial) {
      fallback = { rowNumber, openCount };
    }
    if (!fallback && wantEmail && email && email === wantEmail) {
      fallback = { rowNumber, openCount };
    }
    if (!fallback && wantRef && ref && wantRef !== "n/a" && ref === wantRef) {
      fallback = { rowNumber, openCount };
    }
  }
  return fallback;
}

const SHEET_WORKSPACES = ["main", "sandeer", "amazon"];

export async function syncQueueSendToSheet(
  item: {
    trackingId?: string;
    email?: string;
    serialNo?: string;
    referenceNo?: string;
    sheetRow?: number | null;
  },
  gmailEmail: string,
  ws?: string | null
) {
  const order = [String(ws || "main").toLowerCase(), ...SHEET_WORKSPACES];
  const seen = new Set<string>();
  for (const w of order) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    try {
      const found = await findAutoSheetDataRow(w, item);
      if (!found) continue;
      await batchSetSheetCells(
        [
          {
            rowNumber: found.rowNumber,
            status: "Sent",
            sentAt: new Date().toISOString(),
            gmailUsed: gmailEmail || "",
            trackingId: String(item.trackingId || ""),
          },
        ],
        w
      );
      console.log("[SHEET SENT] ws=" + w + " row=" + found.rowNumber + " tid=" + (item.trackingId || ""));
      return { success: true, rowNumber: found.rowNumber, workspace: w };
    } catch (err) {
      console.error("[SHEET SENT] fail", w, err);
    }
  }
  console.error("[SHEET SENT] row not found", item?.email, item?.trackingId, "ws=" + ws);
  return { success: false };
}

export async function bumpOpenOnAutoSheet(
  trackingId: string,
  openedAtIso?: string,
  preferredWs?: string | null,
  hints?: { email?: string; serialNo?: string; referenceNo?: string }
) {
  const id = String(trackingId || "").trim();
  if (!id) return { success: false, error: "no tracking id" };
  const order = preferredWs
    ? [String(preferredWs).toLowerCase(), ...SHEET_WORKSPACES]
    : [...SHEET_WORKSPACES];
  const seen = new Set<string>();
  for (const w of order) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    try {
      const found = await findAutoSheetDataRow(w, {
        trackingId: id,
        email: hints?.email,
        serialNo: hints?.serialNo,
        referenceNo: hints?.referenceNo,
      });
      if (!found) continue;
      const next = (found.openCount || 0) + 1;
      const openedAt = openedAtIso || new Date().toISOString();
      await batchSetSheetCells(
        [
          {
            rowNumber: found.rowNumber,
            openCount: String(next),
            openedAt,
            trackingId: id,
          },
        ],
        w
      );
      console.log("[OPEN SHEET] ws=" + w + " row=" + found.rowNumber + " count=" + next);
      return { success: true, openCount: next, workspace: w };
    } catch (err) {
      console.error("[OPEN SHEET] fail", w, err);
    }
  }
  return { success: false, error: "tracking id not found on auto sheet" };
}
`;

function patchSheets() {
  if (!fs.existsSync(sheetsPath)) {
    console.log("patch-sheet-sync: no googleSheets");
    return;
  }
  let t = fs.readFileSync(sheetsPath, "utf8");
  if (!t.includes("export async function syncQueueSendToSheet")) {
    const anchor = "export async function recordOpenOnAutoSheet";
    if (!t.includes(anchor)) {
      console.warn("patch-sheet-sync: recordOpenOnAutoSheet missing");
    } else {
      t = t.replace(anchor, HELPERS + "\n" + anchor);
      console.log("patch-sheet-sync: helpers inserted");
    }
  }
  const start = t.indexOf("export async function recordOpenOnAutoSheet");
  const end = t.indexOf("export async function recordOpenOnManualSheet");
  if (start >= 0 && end > start) {
    const neu = `export async function recordOpenOnAutoSheet(
  trackingId: string,
  openedAtIso?: string,
  preferredWs?: string | null
) {
  return bumpOpenOnAutoSheet(trackingId, openedAtIso, preferredWs);
}

`;
    t = t.slice(0, start) + neu + t.slice(end);
    console.log("patch-sheet-sync: recordOpenOnAutoSheet replaced");
  }
  fs.writeFileSync(sheetsPath, t);
}

function patchSender() {
  if (!fs.existsSync(senderPath)) {
    console.log("patch-sheet-sync: no emailSender");
    return;
  }
  let t = fs.readFileSync(senderPath, "utf8");
  if (!t.includes("syncQueueSendToSheet")) {
    t = t.replace(
      'import { readRows, updateRow } from "@/app/services/googleSheets";',
      'import { readRows, updateRow, syncQueueSendToSheet } from "@/app/services/googleSheets";'
    );
  }
  const re =
    /try \{\s*const rows = await readRows\([\s\S]*?console\.error\("Google Sheet update failed", err\);\s*\}/;
  if (re.test(t)) {
    t = t.replace(
      re,
      `try {
      await syncQueueSendToSheet(
        {
          trackingId,
          email: item.email,
          serialNo: item.serialNo,
          referenceNo: item.referenceNo,
          sheetRow: (item as any).sheetRow || (item as any).sheet_row || null,
        },
        finalUsedAccount.email,
        ws
      );
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`
    );
    console.log("patch-sheet-sync: sender sheet block replaced");
  } else if (t.includes("syncQueueSendToSheet(")) {
    console.log("patch-sheet-sync: sender already calls sync");
  } else {
    console.warn("patch-sheet-sync: sender sheet block NOT found");
  }
  fs.writeFileSync(senderPath, t);
}

function patchTrack() {
  if (!fs.existsSync(trackPath)) {
    console.log("patch-sheet-sync: no track route");
    return;
  }
  let t = fs.readFileSync(trackPath, "utf8");
  if (!t.includes('from "@/db"') && t.includes('from "@/db";')) {
    t = t.replace('from "@/db";', 'from "@/db";\nimport { pool } from "@/db";');
  }
  if (t.includes('import { db } from "@/db";') && !t.includes("import { pool }")) {
    t = t.replace('import { db } from "@/db";', 'import { db, pool } from "@/db";');
  }
  if (!t.includes("PIXEL_OPEN_SQL")) {
    const sqlBlock = `      try {
        // PIXEL_OPEN_SQL — atomic, works even if drizzle execute fails
        const upd = await pool.query(
          \`UPDATE queue
             SET open_count = coalesce(open_count, 0) + 1,
                 last_opened_at = $2
           WHERE tracking_id = $1
           RETURNING id, open_count, workspace, email, mark_name, reference_no\`,
          [trackingId, openedAt]
        );
        const row = upd.rows?.[0];
        if (row) {
          try {
            await pool.query(
              \`INSERT INTO tracking_logs
                 (queue_id, tracking_id, ip_address, user_agent, browser, device, opened_at, email, mark_name, reference_no, workspace)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)\`,
              [
                row.id,
                trackingId,
                ipAddress,
                userAgent,
                browser,
                device,
                openedAt,
                row.email || emailFromQuery || null,
                row.mark_name || null,
                row.reference_no || null,
                String(row.workspace || ws || "main").toLowerCase(),
              ]
            );
          } catch (logErr) {
            console.error("tracking log insert:", logErr);
          }
        }
      } catch (e) {
        console.error("queue openCount update failed:", e);
      }`;
    // Replace first openCount update try-block if present
    const coalesceAt = t.indexOf("SET open_count = coalesce");
    const execAt = coalesceAt > 0 ? t.lastIndexOf("await db.execute(", coalesceAt) : -1;
    const updAt = t.indexOf("openCount: (qItem.openCount");
    let replaced = false;
    if (execAt > 0) {
      const tryAt = t.lastIndexOf("try {", execAt);
      const mark = t.indexOf("queue openCount fallback failed:", execAt);
      let end = -1;
      if (mark > 0) {
        let i = t.indexOf("}", mark);
        i = t.indexOf("}", i + 1);
        end = i + 1;
      }
      if (tryAt >= 0 && end > tryAt) {
        t = t.slice(0, tryAt) + sqlBlock + t.slice(end);
        replaced = true;
        console.log("patch-sheet-sync: track execute block replaced");
      }
    }
    if (!replaced && updAt > 0) {
      const tryAt = t.lastIndexOf("try {", updAt);
      const mark = t.indexOf("queue openCount update failed:", updAt);
      const end = mark > 0 ? t.indexOf("}", mark) + 1 : -1;
      if (tryAt >= 0 && end > tryAt) {
        t = t.slice(0, tryAt) + sqlBlock + t.slice(end);
        replaced = true;
        console.log("patch-sheet-sync: track drizzle block replaced");
      }
    }
    if (!replaced) console.warn("patch-sheet-sync: track open block NOT found");
  }
  t = t.replace(
    /after\(async \(\) => \{\s*try \{([\s\S]*?)\}\s*catch \(err\) \{\s*console\.error\("sheet open after\(\) failed:", err\);\s*\}\s*\}\);/g,
    "await (async () => { try {$1} catch (err) { console.error(\"sheet open failed:\", err); } })();"
  );
  fs.writeFileSync(trackPath, t);
}

function patchDash() {
  if (!fs.existsSync(dashPath)) return;
  let t = fs.readFileSync(dashPath, "utf8");
  const oldU = `SELECT COUNT(DISTINCT coalesce(nullif(trim(email), ''), tracking_id))::int AS n
           FROM tracking_logs WHERE workspace = $1`;
  const neuU = `SELECT COUNT(DISTINCT coalesce(nullif(trim(email), ''), tracking_id))::int AS n
           FROM tracking_logs
           WHERE lower(coalesce(nullif(trim(workspace), ''), 'main')) = lower($1)`;
  if (t.includes(oldU)) {
    t = t.replace(oldU, neuU);
    console.log("patch-sheet-sync: unique query case-insensitive");
  }
  const oldQ = `SELECT COUNT(*)::int AS n FROM queue
           WHERE workspace = $1 AND coalesce(open_count, 0) > 0`;
  const neuQ = `SELECT COUNT(*)::int AS n FROM queue
           WHERE lower(coalesce(workspace, 'main')) = lower($1) AND coalesce(open_count, 0) > 0`;
  if (t.includes(oldQ)) {
    t = t.replace(oldQ, neuQ);
    console.log("patch-sheet-sync: unique queue case-insensitive");
  }
  fs.writeFileSync(dashPath, t);
}

patchSheets();
patchSender();
patchTrack();
patchDash();
console.log("patch-sheet-sync: done");
