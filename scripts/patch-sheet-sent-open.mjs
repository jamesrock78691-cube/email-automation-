#!/usr/bin/env node
/**
 * Reliable sheet Sent + Open Count (admin/sandeer/amazon)
 * Uses readRows+updateRow (proven path) with Imported-first matching.
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
  }
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

  const score = (r: GoogleSheetRow) => {
    const st = normSheet(r.status);
    const alreadySent = st === "sent" || st === "done" || st === "success";
    let s = 0;
    if (wantTid && normSheet(r.trackingId) === wantTid) s += 100;
    if (wantSerial && wantSerial !== "n/a" && normSheet(r.serialNo) === wantSerial) s += 50;
    if (wantEmail && normSheet(r.email) === wantEmail) s += 30;
    if (wantRef && wantRef !== "n/a" && normSheet(r.referenceNo) === wantRef) s += 20;
    if (st === "imported" || st === "pending" || st === "") s += 10;
    if (alreadySent) s -= 40;
    return s;
  };

  let best: GoogleSheetRow | null = null;
  let bestScore = 0;
  for (const r of rows) {
    const s = score(r);
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  if (!best || bestScore < 20) return null;
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
      const found = await findAutoSheetDataRow(w, item);
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
      console.log(
        "[SHEET SENT] ok ws=" +
          w +
          " row=" +
          found.rowNumber +
          " tid=" +
          (item.trackingId || "") +
          " email=" +
          (item.email || "")
      );
      return { success: true, rowNumber: found.rowNumber, workspace: w };
    } catch (err) {
      console.error("[SHEET SENT] fail", w, err);
    }
  }
  console.error(
    "[SHEET SENT] row not found",
    item?.email,
    item?.serialNo,
    item?.trackingId,
    "ws=" + ws
  );
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

  // Load more rows so Sent update finds rows beyond first page
  if (!t.includes("getRows({ limit:")) {
    t = t.replace(
      "const rows = await sheet.getRows();",
      "const rows = await sheet.getRows({ limit: 10000 });"
    );
    console.log("patch-sheet-sync: getRows limit 10000");
  }

  // Insert helpers before first export async function if not present
  if (!t.includes("export async function syncQueueSendToSheet")) {
    const anchor = "export async function recordOpenOnAutoSheet";
    if (t.includes(anchor)) {
      t = t.replace(anchor, HELPERS + "\n" + anchor);
      console.log("patch-sheet-sync: helpers inserted before recordOpen");
    } else {
      const a2 = "export async function readRows";
      if (t.includes(a2)) {
        t = t.replace(a2, HELPERS + "\n" + a2);
        console.log("patch-sheet-sync: helpers inserted before readRows");
      } else {
        t = t + "\n" + HELPERS;
        console.log("patch-sheet-sync: helpers appended");
      }
    }
  } else {
    const start = t.indexOf("function normSheet");
    const altStart = t.indexOf("export async function syncQueueSendToSheet");
    const insertAt = start >= 0 ? start : altStart;
    if (insertAt >= 0) {
      let end = t.indexOf("export async function recordOpenOnAutoSheet", insertAt + 10);
      if (end < 0) end = t.indexOf("export async function recordOpenOnManualSheet", insertAt + 10);
      if (end < 0) end = t.length;
      t = t.slice(0, insertAt) + HELPERS + "\n" + t.slice(end);
      console.log("patch-sheet-sync: helpers replaced");
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
    /try \{\s*(?:const rows = await readRows\([\s\S]*?|await syncQueueSendToSheet\([\s\S]*?)console\.error\("Google Sheet update failed", err\);\s*\}/;
  if (re.test(t)) {
    t = t.replace(
      re,
      `try {
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
    }`
    );
    console.log("patch-sheet-sync: sender sheet block replaced");
  } else if (t.includes("syncQueueSendToSheet(")) {
    console.log("patch-sheet-sync: sender already calls sync");
  } else {
    const marker =
      'status: "sent",\n        gmailUsedId: finalUsedAccount.id,';
    if (t.includes(marker) && !t.includes("syncQueueSendToSheet(")) {
      t = t.replace(
        /where\(eq\(queue\.id, item\.id\)\);\s*\n\s*return \{/,
        `where(eq(queue.id, item.id));

    try {
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
    }

    return {`
      );
      console.log("patch-sheet-sync: sender sheet block inserted");
    } else {
      console.warn("patch-sheet-sync: sender sheet block NOT found");
    }
  }
  fs.writeFileSync(senderPath, t);
}

function patchTrack() {
  if (!fs.existsSync(trackPath)) {
    console.log("patch-sheet-sync: no track route");
    return;
  }
  let t = fs.readFileSync(trackPath, "utf8");
  if (t.includes('import { db } from "@/db";') && !t.includes("import { pool }")) {
    t = t.replace('import { db } from "@/db";', 'import { db, pool } from "@/db";');
  }
  fs.writeFileSync(trackPath, t);
}

patchSheets();
patchSender();
patchTrack();
console.log("patch-sheet-sync: done");
