#!/usr/bin/env node
/**
 * Restores emailSender.ts if broken (PLACEHOLDER) and ensures
 * Google Sheet status updates use the workspace-specific sheet.
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

const OLD = `    try {
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
    }`;

const NEW = `    try {
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
    }`;

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

  if (text.includes(OLD)) {
    text = text.replace(OLD, NEW);
    console.log("Patched readRows/updateRow for workspace sheets");
  } else if (text.includes("readRows(ws)")) {
    console.log("Workspace sheet patch already present");
  } else {
    console.log("WARN: sheet update pattern not found (may already differ)");
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
