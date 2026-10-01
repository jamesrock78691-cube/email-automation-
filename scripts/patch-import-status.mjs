#!/usr/bin/env node
/**
 * 1) Allow re-import when sheet says Imported but row not in queue yet.
 * 2) Batch AFTER skip-existing. Return remaining/hasMore so UI can import-all.
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

t = t.replace(
  '["sent", "failed", "imported", "done", "completed"]',
  '["sent", "failed", "done", "completed"]'
);

t = t.replace(
  /const IMPORT_BATCH_LIMIT = 40;\s*let rows = await getPendingRows\(ws\);\s*const totalPending = rows\.length;\s*if \(rows\.length > IMPORT_BATCH_LIMIT\) \{[\s\S]*?\}\n/,
  "let rows = await getPendingRows(ws);\n"
);

t = t.replace(
  "const rows = await getPendingRows(ws);",
  "let rows = await getPendingRows(ws);"
);

t = t.replace("const toInsert: any[] = [];", "let toInsert: any[] = [];");

const BATCH_BLOCK = `  // IMPORT_BATCH_LIMIT_AFTER — only NEW rows, then cap per request (UI loops until done)
  let remainingNew = 0;
  const IMPORT_BATCH_LIMIT = 250;
  if (toInsert.length > IMPORT_BATCH_LIMIT) {
    remainingNew = toInsert.length - IMPORT_BATCH_LIMIT;
    toInsert.length = IMPORT_BATCH_LIMIT;
    if (typeof sheetUpdates !== "undefined" && sheetUpdates.length > IMPORT_BATCH_LIMIT) {
      sheetUpdates.length = IMPORT_BATCH_LIMIT;
    }
    imported = toInsert.length;
    console.log(
      "[SHEETS] batch " + IMPORT_BATCH_LIMIT + " inserted, remaining " + remainingNew
    );
  }

  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {`;

t = t.replace(
  /\/\/ IMPORT_BATCH_LIMIT_AFTER[\s\S]*?for \(let i = 0; i < toInsert\.length; i \+= INSERT_CHUNK\) \{/,
  BATCH_BLOCK
);

if (!t.includes("remainingNew")) {
  const marker = "  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {";
  if (t.includes(marker)) {
    t = t.replace(marker, BATCH_BLOCK);
  }
}

if (!t.includes("hasMore: remainingNew")) {
  t = t.replace(
    `    message: \`Imported \${imported} from "\${cfg.name}" (ws=\${ws}), skipped \${skipped}\${
      errors.length ? \`, errors \${errors.length}\` : ""
    } in \${Math.round(ms / 100) / 10}s\`,
  };`,
    `    remaining: remainingNew,
    hasMore: remainingNew > 0,
    message: \`Imported \${imported} from "\${cfg.name}" (ws=\${ws}), skipped \${skipped}\${
      remainingNew > 0 ? \`, remaining \${remainingNew}\` : ""
    }\${
      errors.length ? \`, errors \${errors.length}\` : ""
    } in \${Math.round(ms / 100) / 10}s\`,
  };`
  );
}

if (!t.includes("let remainingNew") && !t.includes("remainingNew = 0")) {
  t = t.replace(
    "const ms = Date.now() - t0;",
    "const remainingNew = 0;\n  const ms = Date.now() - t0;"
  );
}

fs.writeFileSync(p, t);
console.log("patch-import-status: applied (250/batch + remaining/hasMore)");
