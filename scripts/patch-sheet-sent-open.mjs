#!/usr/bin/env node
/**
 * Reliable sheet Sent + Open Count for main / sandeer / amazon.
 * Runs after restore-googleSheets + restore-emailSender in prebuild.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sheetsPath = path.join(root, "src/app/services/googleSheets.ts");
const senderPath = path.join(root, "src/app/services/emailSender.ts");
const trackPath = path.join(root, "src/app/api/track/[trackingId]/route.ts");

const HELPERS = `
function normSheet(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

const SHEET_WORKSPACES = ["main", "sandeer", "amazon"];

async function findAutoSheetDataRow(
  ws: string | null | undefined,
  match: {
    trackingId?: string;
    email?: string;
    serialNo?: string;
    referenceNo?: string;
    sheetRow?: number | null;
  },
  opts?: { preferImported?: boolean }
): Promise<{ rowNumber: number; openCount: number } | null> {
  const directRow = Number(match.sheetRow || 0);
  if (directRow > 1) {
    return { rowNumber: directRow, openCount: 0 };
  }

  const rows = await readRows(ws);
  const wantTid = normSheet(match.trackingId);
  const wantEmail = normSheet(match.email);
  const wantSerial = normSheet(match.serialNo);
  const wantRef = normSheet(match.referenceNo);
  const preferImported = opts?.preferImported !== false;

  const score = (r: any) => {
    const st = normSheet(r.status);
    const tidMatch = !!(wantTid && normSheet(r.trackingId) === wantTid);
    let s = 0;
    if (tidMatch) s += 100;
    if (wantSerial && wantSerial !== "n/a" && normSheet(r.serialNo) === wantSerial) s += 50;
    if (wantEmail && normSheet(r.email) === wantEmail) s += 30;
    if (wantRef && wantRef !== "n/a" && normSheet(r.referenceNo) === wantRef) s += 20;
    if (preferImported && (st === "imported" || st === "pending" || st === "")) s += 15;
    if ((st === "sent" || st === "done" || st === "success") && !tidMatch) s -= 40;
    return s;
  };

  let best: any = null;
  let bestScore = 0;
  for (const r of rows) {
    const s = score(r);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  if (!best || bestScore < 15) return null;
  const ocRaw = parseInt(String(best.openCount || "0"), 10);
  return {
    rowNumber: best.rowNumber,
    openCount: Number.isFinite(ocRaw) ? ocRaw : 0,
  };
}

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
      const found = await findAutoSheetDataRow(w, item, { preferImported: true });
      if (!found) {
        console.warn("[SHEET SENT] no row ws=" + w + " email=" + (item.email || "") + " serial=" + (item.serialNo || ""));
        continue;
      }
      await updateRow(
        found.rowNumber,
        {
          status: "Sent",
          sentAt: new Date().toISOString(),
          gmailUsed: gmailEmail || "",
          trackingId: String(item.trackingId || ""),
        },
        w
      );
      console.log("[SHEET SENT] ok ws=" + w + " row=" + found.rowNumber + " tid=" + (item.trackingId || "") + " email=" + (item.email || ""));
      return { success: true, rowNumber: found.rowNumber, workspace: w };
    } catch (err) {
      console.error("[SHEET SENT] fail", w, err);
    }
  }
  console.error("[SHEET SENT] row not found", item?.email, item?.serialNo, item?.trackingId, "ws=" + ws);
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

  let h = { ...(hints || {}) };
  if (!h.email && !h.serialNo) {
    try {
      const q = await db.select().from(queue).where(eq(queue.trackingId, id)).limit(1);
      if (q[0]) {
        h = {
          email: q[0].email || h.email,
          serialNo: q[0].serialNo || h.serialNo,
          referenceNo: q[0].referenceNo || h.referenceNo,
        };
      }
    } catch (e) {
      console.warn("[OPEN SHEET] queue hint lookup failed", e);
    }
  }

  const order = preferredWs
    ? [String(preferredWs).toLowerCase(), ...SHEET_WORKSPACES]
    : [...SHEET_WORKSPACES];
  const seen = new Set<string>();
  for (const w of order) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    try {
      const found = await findAutoSheetDataRow(
        w,
        {
          trackingId: id,
          email: h.email,
          serialNo: h.serialNo,
          referenceNo: h.referenceNo,
        },
        { preferImported: false }
      );
      if (!found) continue;
      const next = (found.openCount || 0) + 1;
      const openedAt = openedAtIso || new Date().toISOString();
      await updateRow(
        found.rowNumber,
        {
          openCount: String(next),
          openedAt,
          trackingId: id,
        },
        w
      );
      console.log("[OPEN SHEET] ws=" + w + " row=" + found.rowNumber + " count=" + next);
      return { success: true, openCount: next, workspace: w };
    } catch (err) {
      console.error("[OPEN SHEET] fail", w, err);
    }
  }
  return { success: false, error: "row not found" };
}
`;

function patchSheets() {
  if (!fs.existsSync(sheetsPath)) {
    console.log("patch-sheet-sync: no googleSheets");
    return;
  }
  let t = fs.readFileSync(sheetsPath, "utf8");

  if (!t.includes("getRows({ limit:")) {
    t = t.replace(
      /const rows = await sheet\.getRows\(\);/g,
      "const rows = await sheet.getRows({ limit: 10000 });"
    );
    console.log("patch-sheet-sync: getRows limit 10000");
  }

  if (t.includes("export async function syncQueueSendToSheet")) {
    const start = t.indexOf("function normSheet");
    const alt = t.indexOf("export async function syncQueueSendToSheet");
    const insertAt = start >= 0 ? start : alt;
    let end = t.indexOf("export async function recordOpenOnAutoSheet", insertAt + 5);
    if (end < 0) end = t.indexOf("export async function recordOpenOnManualSheet", insertAt + 5);
    if (insertAt >= 0 && end > insertAt) {
      t = t.slice(0, insertAt) + t.slice(end);
      console.log("patch-sheet-sync: removed old helpers");
    }
  }

  const anchor = "export async function recordOpenOnAutoSheet";
  if (t.includes(anchor)) {
    t = t.replace(anchor, HELPERS + "\n" + anchor);
    console.log("patch-sheet-sync: helpers inserted");
  } else {
    t = t + "\n" + HELPERS;
    console.log("patch-sheet-sync: helpers appended");
  }

  const start = t.indexOf("export async function recordOpenOnAutoSheet");
  const end = t.indexOf("export async function recordOpenOnManualSheet");
  if (start >= 0 && end > start) {
    const neu = `export async function recordOpenOnAutoSheet(
  trackingId: string,
  openedAtIso?: string,
  preferredWs?: string | null,
  hints?: { email?: string; serialNo?: string; referenceNo?: string }
) {
  return bumpOpenOnAutoSheet(trackingId, openedAtIso, preferredWs, hints);
}

`;
    t = t.slice(0, start) + neu + t.slice(end);
    console.log("patch-sheet-sync: recordOpenOnAutoSheet -> bumpOpenOnAutoSheet");
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
      /import\s*\{\s*readRows\s*,\s*updateRow\s*\}\s*from\s*"@\/app\/services\/googleSheets"\s*;/,
      'import { readRows, updateRow, syncQueueSendToSheet } from "@/app/services/googleSheets";'
    );
  }

  const sheetBlockRe =
    /try \{\s*const rows = await readRows\([\s\S]*?console\.error\("Google Sheet update failed", err\);\s*\}/;

  const replacement = `try {
      const sheetResult = await syncQueueSendToSheet(
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
      if (!sheetResult || !(sheetResult as any).success) {
        console.error("[SHEET SENT] sync returned failure", sheetResult);
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`;

  if (sheetBlockRe.test(t)) {
    t = t.replace(sheetBlockRe, replacement);
    console.log("patch-sheet-sync: sender uses syncQueueSendToSheet");
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

  if (!t.includes("after")) {
    t = t.replace(
      /import\s*\{([^}]+)\}\s*from\s*"next\/server"\s*;/,
      (full, inner) => {
        if (String(inner).includes("after")) return full;
        return `import { ${String(inner).trim()}, after } from "next/server";`;
      }
    );
  }

  t = t.replace(
    /recordOpenOnAutoSheet\(\s*trackingId\s*,\s*openedAtIso\s*,\s*ws\s*\)/g,
    `recordOpenOnAutoSheet(trackingId, openedAtIso, ws, {
              email: qItem?.email || emailFromQuery || undefined,
              serialNo: qItem?.serialNo || undefined,
              referenceNo: qItem?.referenceNo || undefined,
            })`
  );

  fs.writeFileSync(trackPath, t);
  console.log("patch-sheet-sync: track hints patched");
}

patchSheets();
patchSender();
patchTrack();
console.log("patch-sheet-sync: done");
