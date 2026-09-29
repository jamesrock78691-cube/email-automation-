#!/usr/bin/env node
/**
 * 1) Allow re-import when sheet says Imported but row not in queue yet.
 * 2) Batch limit applies AFTER filtering already-in-queue rows (so import progresses).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const p = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "services",
  "googleSheets.ts"
);

if (!fs.existsSync(p)) {
  console.log("patch-import-status: no googleSheets.ts");
  process.exit(0);
}

let t = fs.readFileSync(p, "utf8");

// Allow status=Imported to be considered (re-import if not in DB)
t = t.replace(
  '["sent", "failed", "imported", "done", "completed"]',
  '["sent", "failed", "done", "completed"]'
);

// Remove OLD early batch slice if present (it caused 40 skipped forever)
t = t.replace(
  /const IMPORT_BATCH_LIMIT = 40;\s*let rows = await getPendingRows\(ws\);\s*const totalPending = rows\.length;\s*if \(rows\.length > IMPORT_BATCH_LIMIT\) \{[\s\S]*?\}\n/,
  "let rows = await getPendingRows(ws);\n"
);

// Ensure we use let rows
t = t.replace(
  "const rows = await getPendingRows(ws);",
  "let rows = await getPendingRows(ws);"
);

// Batch AFTER toInsert is built (already filtered against existing queue)
if (!t.includes("IMPORT_BATCH_LIMIT_AFTER")) {
  const marker = "  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {";
  if (t.includes(marker)) {
    t = t.replace(
      marker,
      `  // IMPORT_BATCH_LIMIT_AFTER — only NEW rows, then cap for Vercel 60s
  const IMPORT_BATCH_LIMIT = 50;
  if (toInsert.length > IMPORT_BATCH_LIMIT) {
    console.log(
      "[SHEETS] batch " + IMPORT_BATCH_LIMIT + " of " + toInsert.length + " new rows"
    );
    toInsert.length = IMPORT_BATCH_LIMIT;
  }

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {`
    );
  }
}

// toInsert must be let if const
t = t.replace("const toInsert: any[] = [];", "let toInsert: any[] = [];");

fs.writeFileSync(p, t);
console.log("patch-import-status: applied (skip-existing then batch)");
