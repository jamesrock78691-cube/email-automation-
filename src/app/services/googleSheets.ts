import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { randomUUID } from "crypto";

import { db } from "@/db";
import { queue, templates } from "@/db/schema";
import { eq } from "drizzle-orm";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME!;
const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID!;
const MANUAL_SHEET_NAME =
  process.env.GOOGLE_MANUAL_LOG_SHEET_NAME || "Manual Sent Log";
const CREDS = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON!;

if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is missing in .env");
if (!SHEET_NAME) throw new Error("GOOGLE_SHEET_NAME is missing in .env");
if (!CREDS) throw new Error("GOOGLE_SHEETS_CREDENTIALS_JSON is missing in .env");

const credentials = JSON.parse(CREDS);

const auth = new JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

// ===== AUTO SHEET =====
const autoDoc = new GoogleSpreadsheet(SHEET_ID, auth);
let autoInitialized = false;

async function getAutoSheet() {
  if (!autoInitialized) {
    await autoDoc.loadInfo();
    autoInitialized = true;
  }
  const sheet = autoDoc.sheetsByTitle[SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  return sheet;
}

// ===== MANUAL LOG SHEET =====
const manualDoc = MANUAL_SHEET_ID
  ? new GoogleSpreadsheet(MANUAL_SHEET_ID, auth)
  : null;
let manualInitialized = false;

async function getManualSheet() {
  if (!manualDoc) {
    throw new Error("GOOGLE_MANUAL_LOG_SHEET_ID is missing in .env");
  }
  if (!manualInitialized) {
    await manualDoc.loadInfo();
    manualInitialized = true;
  }
  const sheet = manualDoc.sheetsByTitle[MANUAL_SHEET_NAME];
  if (!sheet) throw new Error(`Sheet "${MANUAL_SHEET_NAME}" not found.`);
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

// ========== READ ROWS ==========

export async function readRows(): Promise<GoogleSheetRow[]> {
  const sheet = await getAutoSheet();
  const rows = await sheet.getRows();

  return rows.map((row: any) => ({
    rowNumber: row.rowNumber,
    referenceNo: row.get("reference_no") || row.get("Reference No") || "",
    serialNo: row.get("serial_no") || row.get("Serial No") || "",
    markName: row.get("mark_name") || row.get("Mark Name") || "",
    filingDate: row.get("filing_date") || row.get("Filing Date") || "",
    email: row.get("Email") || row.get("email") || "",
    cc: row.get("CC") || row.get("cc") || "",
    bcc: row.get("BCC") || row.get("bcc") || "",
    subject: row.get("Subject") || row.get("subject") || "",
    templateName: row.get("Template Name") || row.get("template_name") || "",
    status: row.get("Status") || row.get("status") || "",
    sentAt: row.get("Sent At") || "",
    openedAt: row.get("Opened At") || "",
    openCount: row.get("Open Count") || "",
    trackingId: row.get("Tracking ID") || "",
    gmailUsed: row.get("Gmail Used") || "",
  }));
}

export async function updateRow(
  rowNumber: number,
  values: Partial<GoogleSheetRow>
) {
  const sheet = await getAutoSheet();
  const rows = await sheet.getRows();
  const row = rows.find((r: any) => r.rowNumber === rowNumber);

  if (!row) throw new Error(`Google Sheet row ${rowNumber} not found.`);

  if (values.status !== undefined) row.set("Status", values.status);
  if (values.sentAt !== undefined) row.set("Sent At", values.sentAt);
  if (values.openedAt !== undefined) row.set("Opened At", values.openedAt);
  if (values.openCount !== undefined) row.set("Open Count", values.openCount);
  if (values.trackingId !== undefined)
    row.set("Tracking ID", values.trackingId);
  if (values.gmailUsed !== undefined) row.set("Gmail Used", values.gmailUsed);

  await row.save();
}

// ========== PENDING FILTER (SOFT) ==========

export async function getPendingRows() {
  const rows = await readRows();

  console.log("TOTAL SHEET ROWS:", rows.length);
  rows.forEach((row, index) => console.log("ROW", index + 1, row));

  const pendingRows = rows.filter((row) => {
    const email = (row.email || "").trim();
    if (!email) return false;

    const status = (row.status || "").trim().toLowerCase();
    // Skip already processed
    if (["sent", "failed", "imported", "done", "completed"].includes(status)) {
      return false;
    }
    // empty / pending / anything else → import
    return true;
  });

  console.log("PENDING ROWS:", pendingRows.length);
  return pendingRows;
}

// ========== IMPORT TO QUEUE (FIXED) ==========

export async function importPendingRowsToQueue() {
  const rows = await getPendingRows();
  console.log("TOTAL ROWS TO IMPORT:", rows.length);

  const allTemplates = await db.select().from(templates);
  const templatesByName = new Map(
    allTemplates.map((t) => [t.name.trim().toLowerCase(), t.id])
  );
  const fallbackTemplateId =
    allTemplates.length > 0 ? allTemplates[0].id : null;

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const serial =
        (row.serialNo || "").trim() ||
        `AUTO-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

      // Skip duplicate serial in queue
      if (row.serialNo && row.serialNo.trim()) {
        const existing = await db
          .select()
          .from(queue)
          .where(eq(queue.serialNo, row.serialNo.trim()))
          .limit(1);
        if (existing.length > 0) {
          skipped++;
          continue;
        }
      }

      // Template by name, else first template, else null
      let templateId: number | null = null;
      if (row.templateName && row.templateName.trim()) {
        const found = templatesByName.get(
          row.templateName.trim().toLowerCase()
        );
        if (found) templateId = found;
      }
      if (templateId == null) {
        templateId = fallbackTemplateId;
      }

      const trackingId =
        (row.trackingId && row.trackingId.trim()) || randomUUID();

      await db.insert(queue).values({
        campaignId: null, // never hard-code campaign 1
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

      imported++;
    } catch (err: any) {
      console.error("Import row error:", row.email, err);
      errors.push(
        `${row.email}: ${err?.cause?.message || err?.message || "insert failed"}`
      );
    }
  }

  return {
    success: errors.length === 0,
    imported,
    skipped,
    errors,
    message: `Imported ${imported}, skipped ${skipped}${
      errors.length ? `, errors ${errors.length}` : ""
    }`,
  };
}

// ========== MANUAL SENT LOG ==========

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
    });

    return { success: true };
  } catch (err: any) {
    console.error("appendManualSentLog error:", err);
    return { success: false, error: err.message };
  }
}
