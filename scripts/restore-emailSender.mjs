#!/usr/bin/env node
/**
 * Restores emailSender.ts if broken + workspace sheet updates +
 * template vars only mark_name + name.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  __dirname,
  "..",
  "src",
  "app",
  "services",
  "emailSender.ts"
);

const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@16f0d67f0ae19c9f7a5739b9df83c8e3a413e220/src/app/services/emailSender.ts";

function patch(text, oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip:", label);
    return text;
  }
  console.log("Patched:", label);
  return text.split(oldStr).join(newStr);
}

async function main() {
  let text = "";
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  const broken =
    !existing ||
    existing.length < 500 ||
    existing.includes("PLACEHOLDER") ||
    !existing.includes("processNextQueueItem");

  if (broken) {
    console.log("emailSender broken — fetching known-good source…");
    const res = await fetch(SOURCE, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching emailSender`);
    text = await res.text();
  } else {
    text = existing;
  }

  if (!text.includes("processNextQueueItem")) {
    throw new Error("emailSender source invalid");
  }

  // Workspace-aware sheet updates
  text = patch(
    text,
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
    }`,
    "workspace sheet update"
  );

  // Only mark_name + name for templates (name stored in queue.referenceNo)
  text = patch(
    text,
    `  const variables = {
    reference_no: item.referenceNo || "",
    serial_no: item.serialNo || "",
    mark_name: item.markName || "",
    filing_date: item.filingDate || "",
    owner_name: (item.markName || "") + " Legal Owner",
    client_name: (item.markName || "") + " Client",
    email: item.email,
    today: todayStr,
    tracking_pixel: trackingPixelHtml,
  };`,
    `  // Template variables: ONLY mark_name + name (from sheet)
  const variables = {
    mark_name: item.markName || "",
    name: item.referenceNo || "",
    tracking_pixel: trackingPixelHtml,
  };`,
    "template vars mark_name+name only"
  );

  // Also handle if already partially patched with more fields
  if (
    text.includes("owner_name:") &&
    text.includes("const variables = {")
  ) {
    text = text.replace(
      /const variables = \{[\s\S]*?tracking_pixel: trackingPixelHtml,\s*\};/,
      `const variables = {
    mark_name: item.markName || "",
    name: item.referenceNo || "",
    tracking_pixel: trackingPixelHtml,
  };`
    );
    console.log("Patched variables via regex fallback");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("Wrote", OUT, text.length, "bytes");
}

main().catch((e) => {
  console.error("restore-emailSender failed:", e?.message || e);
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8").length < 500) {
    process.exit(1);
  }
});
