import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { randomUUID } from "crypto";

import { db } from "@/db";
import { queue, templates } from "@/db/schema";
import { eq } from "drizzle-orm";

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

async function getAutoSheet() {
  if (!SHEET_ID) throw new Error("GOOGLE_SHEET_ID is missing in Vercel env");
  if (!SHEET_NAME) throw new Error("GOOGLE_SHEET_NAME is missing in Vercel env");
  const jwt = ensureAuth();
  if (!autoDoc) {
    autoDoc = new GoogleSpreadsheet(SHEET_ID, jwt);
  }
  if (!autoInitialized) {
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

export async function getPendingRows() {
  const rows = await readRows();

  console.log("TOTAL SHEET ROWS:", rows.length);
  rows.forEach((row, index) => console.log("ROW", index + 1, row));

  const pendingRows = rows.filter((row) => {
    const email = (row.email || "").trim();
    if (!email) return false;

    const status = (row.status || "").trim().toLowerCase();
    if (["sent", "failed", "imported", "done", "completed"].includes(status)) {
      return false;
    }
    return true;
  });

  console.log("PENDING ROWS:", pendingRows.length);
  return pendingRows;
}

export async function importPendingRowsToQueue(forcedTemplateId?: number | null) {
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

      if (row.serialNo && row.serialNo.trim()) {
        const existing = await db
          .select()
          .from(queue)
          .where(eq(queue.serialNo, row.serialNo.trim()))
          .limit(1);
        if (existing.length > 0) {
          skipped++;
          const st = (row.status || "").trim().toLowerCase();
          if (!st || st === "pending") {
            try {
              await updateRow(row.rowNumber, {
                status: "Imported",
                trackingId: existing[0].trackingId || row.trackingId || "",
              });
            } catch {}
          }
          continue;
        }
      }

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

      // Sheet pe Status + Tracking ID update
      try {
        await updateRow(row.rowNumber, {
          status: "Imported",
          trackingId,
        });
      } catch (sheetErr: any) {
        console.error(
          "Sheet status update failed for row",
          row.rowNumber,
          sheetErr?.message || sheetErr
        );
        errors.push(
          `${row.email}: imported to queue but sheet Status update failed (${sheetErr?.message || "error"})`
        );
      }

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
