#!/usr/bin/env node
/**
 * Restore googleSheets.ts from last known-good commit (fixes SEE_FILE corruption).
 * patch-sandeer-sheets.mjs runs after this and applies sandeer/manual open fixes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "services",
  "googleSheets.ts"
);

const SOURCES = [
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@9a8f014f1b48ba5770550ebd1a0051a2e385bdee/src/app/services/googleSheets.ts",
  "https://raw.githubusercontent.com/jamesrock78691-cube/email-automation-/9a8f014f1b48ba5770550ebd1a0051a2e385bdee/src/app/services/googleSheets.ts",
];

async function main() {
  let text = "";
  let lastErr = null;
  for (const url of SOURCES) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
      text = await res.text();
      if (text.includes("export async function importPendingRowsToQueue")) {
        console.log("restore-googleSheets: fetched from", url.slice(0, 60));
        break;
      }
      text = "";
    } catch (e) {
      lastErr = e;
    }
  }
  if (!text) {
    // If existing file on disk is valid, keep it
    if (fs.existsSync(OUT)) {
      const existing = fs.readFileSync(OUT, "utf8");
      if (
        existing.includes("export async function importPendingRowsToQueue") &&
        !existing.includes("SEE_FILE")
      ) {
        console.log("restore-googleSheets: keeping existing valid file");
        return;
      }
    }
    throw new Error(
      "restore-googleSheets failed: " + (lastErr?.message || "no source")
    );
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("restore-googleSheets: wrote", text.length, "bytes");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
