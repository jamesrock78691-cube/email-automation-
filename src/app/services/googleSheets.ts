import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { randomUUID } from "crypto";

import { db } from "@/db";
import { queue, templates } from "@/db/schema";
import { inArray } from "drizzle-orm";

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "";
const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID || "";
const MANUAL_SHEET_NAME =
  process.env.GOOGLE_MANUAL_LOG_SHEET_NAME || "Manual Sent Log";
const CREDS = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON || "";

let autoDoc: GoogleSpreadsheet | null = null;
let autoInitialized = false;
let manualDoc: GoogleSpreadsheet | null = null;
let manualInitialized = false;
let auth: JWT | null = null;

function ensureAuth() {
  if (!CREDS) {
    throw new Error(
      "GOOGLE_SHEETS_CREDENTIALS_JSON is missing in Vercel env. Add service account JSON."
    );
  }
  if (!auth) {
    const credentials = JSON.parse(CREDS);
    if (credentials.private_key && typeof credentials.private_key === "string") {
      credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
    }
    auth = new JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });
  }
  return auth;
}

async function getAutoSheet(opts?: { refresh?: boolean }) {
  if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is missing in Vercel env");
  if (!SHEET_NAME) throw new Error("GOOGLE_SHEET_NAME is missing in Vercel env");
  const jwt = ensureAuth();
  if (!autoDoc) {
    autoDoc = new GoogleSpreadsheet(SHEET_ID, jwt);
  }
  if (!autoInitialized || opts?.refresh) {
    await autoDoc.loadInfo();
    autoInitialized = true;
  }
  const sheet = autoDoc.sheetsByTitle[SHEET_NAME];
  if (!sheet) {
    const names = Object.keys(autoDoc.sheetsByTitle || {}).join(", ");
    throw new Error(
      `Sheet tab "${SHEET_NAME}" not found. Available tabs: ${names || "(none)"}`
    );
  }
  return sheet;
}

async function getManualSheet() {
  if (!MANUAL_SHEET_ID) {
    throw new Error("GOOGLE_MANUAL_LOG_SHEET_ID is missing in Vercel env");
  }
  const jwt = ensureAuth();
  if (!manualDoc) {
    manualDoc = new GoogleSpreadsheet(MANUAL_SHEET_ID, jwt);
  }
  if (!manualInitialized) {
    await manualDoc.loadInfo();
    manualInitialized = true;
  }
  const sheet = manualDoc.sheetsByTitle[MANUAL_SHEET_NAME];
  if (!sheet) {
    throw new Error(`Sheet tab "${MANUAL_SHEET_NAME}" not found.`);
  }
  return sheet;
}

export interface GoogleSheetRow {
  rowNumber: number;
  referenceNo: string;
  serialNo: string;
  markName: string;
  filingDate: string;
  email: string;
  cc: string;
  bcc: string;
  subject: string;
  templateName: string;
  status: string;
  sentAt: string;
  openedAt: string;
  openCount: string;
  trackingId: string;
  gmailUsed: string;
}

function headerIndex(headers: string[], ...names: string[]): number {
  const want = names.map((n) => n.trim().toLowerCase());
  return headers.findIndex((h) =>
    want.includes(String(h || "").trim().toLowerCase())
  );
}

function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type SheetCellPatch = {
  rowNumber: number;
  status?: string;
  trackingId?: string;
  sentAt?: string;
  openedAt?: string;
  openCount?: string;
  gmailUsed?: string;
};

/** One Sheets round-trip for many cells (no per-row save). */
async function batchSetSheetCells(updates: SheetCellPatch[]) {
  if (!updates.length) return;
  const sheet = await getAutoSheet();
  await sheet.loadHeaderRow();
  const headers: string[] = (sheet.headerValues || []).map((h: any) =>
    String(h || "")
  );
  const cols = {
    status: headerIndex(headers, "Status", "status"),
    trackingId: headerIndex(
      headers,
      "Tracking ID",
      "tracking_id",
      "Tracking Id"
    ),
    sentAt: headerIndex(headers, "Sent At", "sent_at"),
    openedAt: headerIndex(headers, "Opened At", "opened_at"),
    openCount: headerIndex(headers, "Open Count", "open_count"),
    gmailUsed: headerIndex(headers, "Gmail Used", "gmail_used"),
  };
  const used = Object.values(cols).filter((c) => c >= 0);
  if (!used.length) return;

  const startCol = Math.min(...used);
  const endCol = Math.max(...used);
  const sorted = [...updates].sort((a, b) => a.rowNumber - b.rowNumber);

  const CHUNK = 250;
  for (let i = 0; i < sorted.length; i += CHUNK) {
    const chunk = sorted.slice(i, i + CHUNK);
    const minRow = chunk[0].rowNumber;
    const maxRow = chunk[chunk.length - 1].rowNumber;
    const a1 = `${colLetter(startCol)}${minRow}:${colLetter(endCol)}${maxRow}`;
    await sheet.loadCells(a1);

    for (const u of chunk) {
      const r = u.rowNumber - 1;
      if (u.status !== undefined && cols.status >= 0) {
        sheet.getCell(r, cols.status).value = u.status;
      }
      if (u.trackingId !== undefined && cols.trackingId >= 0) {
        sheet.getCell(r, cols.trackingId).value = u.trackingId;
      }
      if (u.sentAt !== undefined && cols.sentAt >= 0) {
        sheet.getCell(r, cols.sentAt).value = u.sentAt;
      }
      if (u.openedAt !== undefined && cols.openedAt >= 0) {
        sheet.getCell(r, cols.openedAt).value = u.openedAt;
      }
      if (u.openCount !== undefined && cols.openCount >= 0) {
        sheet.getCell(r, cols.openCount).value = u.openCount;
      }
      if (u.gmailUsed !== undefined && cols.gmailUsed >= 0) {
        sheet.getCell(r, cols.gmailUsed).value = u.gmailUsed;
      }
    }
    await sheet.saveUpdatedCells();
  }
}

export async function readRows(): Promise<GoogleSheetRow[]> {
  const sheet = await getAutoSheet();
  const rows = await sheet.getRows();

  const pick = (row: any, ...keys: string[]) => {
    for (const k of keys) {
      const v = row.get(k);
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        return String(v).trim();
      }
    }
    try {
      const obj = row.toObject ? row.toObject() : {};
      const lowerMap: Record<string, string> = {};
      for (const [hk, hv] of Object.entries(obj)) {
        lowerMap[String(hk).trim().toLowerCase()] = String(hv ?? "");
      }
      for (const k of keys) {
        const found = lowerMap[k.trim().toLowerCase()];
        if (found && found.trim()) return found.trim();
      }
    } catch {}
    return "";
  };

  return rows.map((row: any) => ({
    rowNumber: row.rowNumber,
    referenceNo: pick(row, "reference_no", "Reference No", "Reference", "ref"),
    serialNo: pick(row, "serial_no", "Serial No", "Serial", "serial"),
    markName: pick(row, "mark_name", "Mark Name", "Mark", "trademark"),
    filingDate: pick(row, "filing_date", "Filing Date", "Date"),
    email: pick(row, "Email", "email", "E-mail", "email address", "to"),
    cc: pick(row, "CC", "cc"),
    bcc: pick(row, "BCC", "bcc"),
    subject: pick(row, "Subject", "subject"),
    templateName: pick(
      row,
      "Template Name",
      "template_name",
      "Template",
      "template"
    ),
    status: pick(row, "Status", "status"),
    sentAt: pick(row, "Sent At", "sent_at"),
    openedAt: pick(row, "Opened At", "opened_at"),
    openCount: pick(row, "Open Count", "open_count"),
    trackingId: pick(row, "Tracking ID", "tracking_id", "Tracking Id"),
    gmailUsed: pick(row, "Gmail Used", "gmail_used"),
  }));
}

export async function updateRow(
  rowNumber: number,
  values: Partial<GoogleSheetRow>
) {
  await batchSetSheetCells([
    {
      rowNumber,
      status: values.status,
      trackingId: values.trackingId,
      sentAt: values.sentAt,
      openedAt: values.openedAt,
      openCount: values.openCount,
      gmailUsed: values.gmailUsed,
    },
  ]);
}

export async function getPendingRows() {
  const rows = await readRows();
  const pendingRows = rows.filter((row) => {
    const email = (row.email || "").trim();
    if (!email) return false;

    const status = (row.status || "").trim().toLowerCase();
    if (["sent", "failed", "imported", "done", "completed"].includes(status)) {
      return false;
    }
    return true;
  });
  console.log(
    `Sheet rows: ${rows.length}, pending to import: ${pendingRows.length}`
  );
  return pendingRows;
}

export async function importPendingRowsToQueue(forcedTemplateId?: number | null) {
  const t0 = Date.now();
  await getAutoSheet({ refresh: true });
  const rows = await getPendingRows();

  const allTemplates = await db.select().from(templates);
  const templatesByName = new Map(
    allTemplates.map((t) => [t.name.trim().toLowerCase(), t.id])
  );
  const fallbackTemplateId =
    forcedTemplateId != null &&
    allTemplates.some((t) => t.id === forcedTemplateId)
      ? forcedTemplateId
      : allTemplates.length > 0
        ? allTemplates[0].id
        : null;

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const serials = Array.from(
    new Set(
      rows
        .map((r) => (r.serialNo || "").trim())
        .filter((s) => s.length > 0)
    )
  );

  const existingMap = new Map<string, string>();
  const SERIAL_CHUNK = 400;
  for (let i = 0; i < serials.length; i += SERIAL_CHUNK) {
    const chunk = serials.slice(i, i + SERIAL_CHUNK);
    const existing = await db
      .select({
        serialNo: queue.serialNo,
        trackingId: queue.trackingId,
      })
      .from(queue)
      .where(inArray(queue.serialNo, chunk));
    for (const e of existing) {
      if (e.serialNo) existingMap.set(e.serialNo.trim(), e.trackingId || "");
    }
  }

  const toInsert: any[] = [];
  const sheetUpdates: SheetCellPatch[] = [];
  const seenSerial = new Set<string>();

  for (const row of rows) {
    try {
      const serialTrim = (row.serialNo || "").trim();
      const serial =
        serialTrim ||
        `AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      if (serialTrim && (existingMap.has(serialTrim) || seenSerial.has(serialTrim))) {
        skipped++;
        const st = (row.status || "").trim().toLowerCase();
        if (!st || st === "pending") {
          sheetUpdates.push({
            rowNumber: row.rowNumber,
            status: "Imported",
            trackingId:
              existingMap.get(serialTrim) || row.trackingId || "",
          });
        }
        continue;
      }

      let templateId: number | null = null;
      if (row.templateName && row.templateName.trim()) {
        const found = templatesByName.get(row.templateName.trim().toLowerCase());
        if (found) templateId = found;
      }
      if (templateId == null) templateId = fallbackTemplateId;

      const trackingId =
        (row.trackingId && row.trackingId.trim()) || randomUUID();

      toInsert.push({
        campaignId: null,
        referenceNo: (row.referenceNo || "").trim() || "N/A",
        serialNo: serial,
        markName: (row.markName || "").trim() || "N/A",
        filingDate:
          (row.filingDate || "").trim() ||
          new Date().toISOString().slice(0, 10),
        email: row.email.trim(),
        cc: row.cc ? row.cc.trim() : null,
        bcc: row.bcc ? row.bcc.trim() : null,
        subject: (row.subject || "").trim() || "Trademark Notice",
        templateId,
        status: "pending",
        trackingId,
        tries: 0,
        maxTries: 3,
      });
      sheetUpdates.push({
        rowNumber: row.rowNumber,
        status: "Imported",
        trackingId,
      });
      seenSerial.add(serial);
      existingMap.set(serial, trackingId);
      imported++;
    } catch (err: any) {
      errors.push(
        `${row.email}: ${err?.cause?.message || err?.message || "prepare failed"}`
      );
    }
  }

  const INSERT_CHUNK = 80;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK);
    try {
      await db.insert(queue).values(chunk);
    } catch (err: any) {
      for (const item of chunk) {
        try {
          await db.insert(queue).values(item);
        } catch (oneErr: any) {
          imported = Math.max(0, imported - 1);
          errors.push(
            `${item.email}: ${oneErr?.cause?.message || oneErr?.message || "insert failed"}`
          );
        }
      }
    }
  }

  try {
    await batchSetSheetCells(sheetUpdates);
  } catch (sheetErr: any) {
    console.error("batch sheet import update failed:", sheetErr);
    errors.push(
      `Queue imported but sheet Status update failed: ${sheetErr?.message || sheetErr}`
    );
  }

  const ms = Date.now() - t0;
  return {
    success: errors.length === 0,
    imported,
    skipped,
    errors,
    message: `Imported ${imported}, skipped ${skipped}${
      errors.length ? `, errors ${errors.length}` : ""
    } in ${Math.round(ms / 100) / 10}s`,
  };
}

export interface ManualLogRow {
  referenceNo?: string;
  serialNo?: string;
  markName?: string;
  filingDate?: string;
  email: string;
  cc?: string;
  bcc?: string;
  subject: string;
  templateName?: string;
  status?: string;
  sentAt?: string;
  gmailUsed?: string;
  sentBy?: string;
  sentById?: string | number;
  trackingId?: string;
}

export async function appendManualSentLog(data: ManualLogRow) {
  try {
    if (!MANUAL_SHEET_ID) {
      console.warn("GOOGLE_MANUAL_LOG_SHEET_ID not set — skipping manual log");
      return { success: false, error: "Manual sheet ID not configured" };
    }

    const sheet = await getManualSheet();

    await sheet.addRow({
      referenceNo: data.referenceNo || "",
      serialNo: data.serialNo || "",
      markName: data.markName || "",
      filingDate: data.filingDate || "",
      Email: data.email || "",
      CC: data.cc || "",
      BCC: data.bcc || "",
      Subject: data.subject || "",
      "Template Name": data.templateName || "",
      Status: data.status || "Sent",
      "Sent At": data.sentAt || new Date().toISOString(),
      "Gmail Used": data.gmailUsed || "",
      "Sent By": data.sentBy || "",
      "Sent By ID": data.sentById != null ? String(data.sentById) : "",
      "Tracking ID": data.trackingId || "",
      "Open Count": "0",
      "Opened At": "",
    });

    return { success: true };
  } catch (err: any) {
    console.error("appendManualSentLog error:", err);
    return { success: false, error: err.message };
  }
}

/** Increment open count on auto (queue) Google Sheet by tracking ID */
export async function recordOpenOnAutoSheet(
  trackingId: string,
  openedAtIso?: string
) {
  try {
    if (!SHEET_ID || !trackingId) return { success: false };
    const sheet = await getAutoSheet();
    const rows = await sheet.getRows();
    const id = String(trackingId).trim();
    const openedAt = openedAtIso || new Date().toISOString();

    for (const row of rows as any[]) {
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const v = row.get(k);
          if (v !== undefined && v !== null && String(v).trim() !== "") {
            return String(v).trim();
          }
        }
        return "";
      };
      const tid = pick("Tracking ID", "tracking_id", "Tracking Id");
      if (tid !== id) continue;

      const prev = parseInt(pick("Open Count", "open_count") || "0", 10);
      const next = (Number.isFinite(prev) ? prev : 0) + 1;
      row.set("Open Count", String(next));
      row.set("Opened At", openedAt);
      await row.save();
      return {
        success: true,
        openCount: next,
        email: pick("Email", "email"),
        referenceNo: pick("reference_no", "Reference No", "Reference"),
        markName: pick("mark_name", "Mark Name", "Mark"),
      };
    }
    return { success: false, error: "tracking id not found on auto sheet" };
  } catch (err: any) {
    console.error("recordOpenOnAutoSheet error:", err);
    return { success: false, error: err?.message || String(err) };
  }
}

/** Increment open count on manual sent log Google Sheet by tracking ID */
export async function recordOpenOnManualSheet(
  trackingId: string,
  openedAtIso?: string
) {
  try {
    if (!MANUAL_SHEET_ID || !trackingId) return { success: false };
    const sheet = await getManualSheet();
    const rows = await sheet.getRows();
    const id = String(trackingId).trim();
    const openedAt = openedAtIso || new Date().toISOString();

    for (const row of rows as any[]) {
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const v = row.get(k);
          if (v !== undefined && v !== null && String(v).trim() !== "") {
            return String(v).trim();
          }
        }
        try {
          const obj = row.toObject ? row.toObject() : {};
          for (const [hk, hv] of Object.entries(obj)) {
            if (
              keys.some((k) => k.trim().toLowerCase() === String(hk).trim().toLowerCase()) &&
              hv != null &&
              String(hv).trim()
            ) {
              return String(hv).trim();
            }
          }
        } catch {}
        return "";
      };
      const tid = pick("Tracking ID", "tracking_id", "Tracking Id");
      if (tid !== id) continue;

      const prev = parseInt(pick("Open Count", "open_count") || "0", 10);
      const next = (Number.isFinite(prev) ? prev : 0) + 1;
      try {
        row.set("Open Count", String(next));
      } catch {
        row.set("open_count", String(next));
      }
      try {
        row.set("Opened At", openedAt);
      } catch {
        row.set("opened_at", openedAt);
      }
      await row.save();
      return {
        success: true,
        openCount: next,
        email: pick("Email", "email"),
        subject: pick("Subject", "subject"),
        referenceNo: pick("referenceNo", "Reference No", "reference_no"),
        markName: pick("markName", "Mark Name", "mark_name"),
      };
    }
    return { success: false, error: "tracking id not found on manual sheet" };
  } catch (err: any) {
    console.error("recordOpenOnManualSheet error:", err);
    return { success: false, error: err?.message || String(err) };
  }
}
