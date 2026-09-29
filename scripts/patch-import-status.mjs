#!/usr/bin/env node
/**
 * 1) Allow re-import when sheet says Imported but row not in queue.
 * 2) Cap each import to 40 rows so Vercel hobby (60s) does not 504.
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
const before = t;

t = t.replace(
  '["sent", "failed", "imported", "done", "completed"]',
  '["sent", "failed", "done", "completed"]'
);

// Limit rows per import call (must stay under serverless timeout)
if (!t.includes("IMPORT_BATCH_LIMIT")) {
  t = t.replace(
    "const rows = await getPendingRows(ws);",
    `const IMPORT_BATCH_LIMIT = 40;
  let rows = await getPendingRows(ws);
  const totalPending = rows.length;
  if (rows.length > IMPORT_BATCH_LIMIT) {
    rows = rows.slice(0, IMPORT_BATCH_LIMIT);
    console.log(
      "[SHEETS] import batch limit " +
        IMPORT_BATCH_LIMIT +
        " of " +
        totalPending +
        " pending"
    );
  }`
  );
}

if (t === before) {
  console.log("patch-import-status: skip (already applied or patterns missing)");
} else {
  fs.writeFileSync(p, t);
  console.log("patch-import-status: applied status + batch limit");
}
