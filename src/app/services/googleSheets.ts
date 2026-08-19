import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";

import { db } from "@/db";
import { queue, templates } from "@/db/schema";
import { eq } from "drizzle-orm";

const SHEET_ID = process.env.GOOGLE_SHEET_ID!;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME!;
const CREDS = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON!;

if (!SHEET_ID) {
  throw new Error("GOOGLE_SHEET_ID is missing in .env");
}

if (!SHEET_NAME) {
  throw new Error("GOOGLE_SHEET_NAME is missing in .env");
}

if (!CREDS) {
  throw new Error("GOOGLE_SHEETS_CREDENTIALS_JSON is missing in .env");
}

const credentials = JSON.parse(CREDS);

const auth = new JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

const document = new GoogleSpreadsheet(SHEET_ID, auth);

let initialized = false;

async function getSheet() {
  if (!initialized) {
    await document.loadInfo();
    initialized = true;
  }

  const sheet = document.sheetsByTitle[SHEET_NAME];

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
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
  const sheet = await getSheet();

  const rows = await sheet.getRows();

  return rows.map((row: any) => ({
    rowNumber: row.rowNumber,

    referenceNo: row.get("Reference No") || "",
    serialNo: row.get("serial_no") || "",
    markName: row.get("Mark Name") || "",
    filingDate: row.get("Filing Date") || "",

    email: row.get("Email") || "",
    cc: row.get("CC") || "",
    bcc: row.get("BCC") || "",

    subject: row.get("Subject") || "",
    templateName: row.get("Template Name") || "",

    status: row.get("Status") || "",

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
  const sheet = await getSheet();

  const rows = await sheet.getRows();

  const row = rows.find((r: any) => r.rowNumber === rowNumber);

  if (!row) {
    throw new Error(`Google Sheet row ${rowNumber} not found.`);
  }

  if (values.status !== undefined) row.set("Status", values.status);
  if (values.sentAt !== undefined) row.set("Sent At", values.sentAt);
  if (values.openedAt !== undefined) row.set("Opened At", values.openedAt);
  if (values.openCount !== undefined) row.set("Open Count", values.openCount);
  if (values.trackingId !== undefined) row.set("Tracking ID", values.trackingId);
  if (values.gmailUsed !== undefined) row.set("Gmail Used", values.gmailUsed);

  await row.save();
}  

export async function getPendingRows() {

  const rows = await readRows();

  console.log(
    "TOTAL SHEET ROWS:",
    rows.length
  );

rows.forEach((row, index) => {
  console.log("ROW", index + 1, row);
});

  const pendingRows = rows.filter((row) => {

    return (
      row.referenceNo.trim() !== "" &&
      row.serialNo.trim() !== "" &&
      row.markName.trim() !== "" &&
      row.filingDate.trim() !== "" &&
      row.email.trim() !== "" &&
      row.subject.trim() !== "" &&
      row.templateName.trim() !== "" &&
      (
        row.status.trim() === "" ||
        row.status.toLowerCase() === "pending"
      )
    );

  });


  console.log(
    "PENDING ROWS:",
    pendingRows.length
  );


  return pendingRows;

}
export async function importPendingRowsToQueue() {
  const rows = await getPendingRows();

console.log("TOTAL ROWS:", rows.length);
console.log(rows);

  let fallbackTemplateId: number | null = null;

  const existingTemplates = await db
    .select()
    .from(templates)
    .limit(1);

  if (existingTemplates.length > 0) {
    fallbackTemplateId = existingTemplates[0].id;
  }

  let imported = 0;

  for (const row of rows) {
    // Skip duplicate serial_no
    const existing = await db
      .select()
      .from(queue)
      .where(eq(queue.serialNo, row.serialNo))
      .limit(1);

    if (existing.length > 0) {
      continue;
    }

    const trackingId =
      row.trackingId ||
      `track_${row.serialNo}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    await db.insert(queue).values({
      campaignId: 1,
      referenceNo: row.referenceNo,
      serialNo: row.serialNo,
      markName: row.markName,
      filingDate: row.filingDate,
      email: row.email,
      cc: row.cc,
      bcc: row.bcc,
      subject: row.subject,
      templateId: fallbackTemplateId,
      status: "pending",
      trackingId,
      tries: 0,
      maxTries: 3,
    });

    await updateRow(row.rowNumber, {
      status: "Imported",
      trackingId,
    });

    imported++;
  }

  return {
    success: true,
    imported,
  };
}