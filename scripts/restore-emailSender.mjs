#!/usr/bin/env node
/**
 * ALWAYS rewrite emailSender.ts from known-good CDN + Amazon/main variables (if/else).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "app", "services", "emailSender.ts");

const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@16f0d67f0ae19c9f7a5739b9df83c8e3a413e220/src/app/services/emailSender.ts";

const CLEAN_VARS = `  // Amazon: only mark_name + name. Main: full set.
  const isAmazon =
    String(ws || "").toLowerCase() === AMAZON_WORKSPACE ||
    String(ws || "").toLowerCase() === "amazon";
  const variables: Record<string, string> = {
    tracking_pixel: trackingPixelHtml,
  };
  if (isAmazon) {
    variables.mark_name = item.markName || "";
    variables.name = item.referenceNo || "";
  } else {
    variables.reference_no = item.referenceNo || "";
    variables.serial_no = item.serialNo || "";
    variables.mark_name = item.markName || "";
    variables.filing_date = item.filingDate || "";
    variables.owner_name = (item.markName || "") + " Legal Owner";
    variables.client_name = (item.markName || "") + " Client";
    variables.email = item.email || "";
    variables.today = todayStr;
  }`;

async function main() {
  console.log("Fetching emailSender source…");
  const res = await fetch(SOURCE, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let text = await res.text();
  if (!text.includes("processNextQueueItem")) throw new Error("invalid source");

  if (!text.includes("AMAZON_WORKSPACE")) {
    text = text.replace(
      `import { workspaceSql, MAIN_WORKSPACE } from "@/lib/workspace";`,
      `import { workspaceSql, MAIN_WORKSPACE, AMAZON_WORKSPACE } from "@/lib/workspace";`
    );
  }

  // Sheet updates
  text = text.replace(
    `    try {
      const rows = await readRows();
      const sheetRow = rows.find(
        (r) =>
          r.serialNo?.trim() === item.serialNo?.trim() ||
          r.referenceNo?.trim() === item.referenceNo?.trim()
      );
      if (sheetRow) {
        await updateRow(sheetRow.rowNumber, {
          status: "Sent",
          sentAt: new Date().toISOString(),
          gmailUsed: finalUsedAccount.email,
          trackingId: trackingId,
        });
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`,
    `    try {
      const rows = await readRows(ws);
      const sheetRow = rows.find(
        (r) =>
          (item.email &&
            r.email?.trim().toLowerCase() === item.email.trim().toLowerCase()) ||
          r.serialNo?.trim() === item.serialNo?.trim() ||
          r.referenceNo?.trim() === item.referenceNo?.trim()
      );
      if (sheetRow) {
        await updateRow(
          sheetRow.rowNumber,
          {
            status: "Sent",
            sentAt: new Date().toISOString(),
            gmailUsed: finalUsedAccount.email,
            trackingId: trackingId,
          },
          ws
        );
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`
  );

  // Variables — always replace original block
  const re =
    /  const variables = \{\s*\n\s*reference_no:[\s\S]*?tracking_pixel: trackingPixelHtml,\s*\n\s*\};/;
  if (!re.test(text)) throw new Error("variables block not found in source");
  text = text.replace(re, CLEAN_VARS);

  if (/const variables\s*=\s*isAmazon/.test(text)) {
    throw new Error("ternary variables still present");
  }
  if (!text.includes("if (isAmazon)")) {
    throw new Error("if (isAmazon) missing after patch");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("Wrote", OUT, text.length, "bytes");
}

main().catch((e) => {
  console.error("restore-emailSender FAILED:", e?.message || e);
  process.exit(1);
});
