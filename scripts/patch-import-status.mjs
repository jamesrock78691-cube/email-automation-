#!/usr/bin/env node
/** Allow re-import when sheet says Imported but row is not in queue yet. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "services", "googleSheets.ts");
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
if (t === before) {
  console.log("patch-import-status: skip (pattern not found or already patched)");
} else {
  fs.writeFileSync(p, t);
  console.log("patch-import-status: allow re-import of sheet status=Imported");
}
