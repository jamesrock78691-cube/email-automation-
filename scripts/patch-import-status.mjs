#!/usr/bin/env node
/**
 * Admin/main (and all workspaces) Google Sheet import fixes:
 * 1) Re-import rows marked Imported if not already in queue
 * 2) Treat blank / Pending / Ready as importable
 * 3) Larger batches + remaining/hasMore for one-click import-all UI
 * 4) Clearer zero-pending message
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
  console.log("patch-import-status: no googleSheets");
  process.exit(0);
}

let t = fs.readFileSync(p, "utf8");

// Allow re-import of "imported"; only skip terminal statuses
t = t.replace(
  '["sent", "failed", "imported", "done", "completed"]',
  '["sent", "failed", "done", "completed", "success"]'
);

// Also handle if already patched once
if (!t.includes('["sent", "failed", "done", "completed", "success"]')) {
  t = t.replace(
    /if \(\[([^\]]+)\]\.includes\(status\)\)/,
    'if (["sent", "failed", "done", "completed", "success"].includes(status))'
  );
}

// Require valid-looking email
if (!t.includes('!email.includes("@")')) {
  t = t.replace(
    'const email = (row.email || "").trim();\n    if (!email) return false;',
    'const email = (row.email || "").trim();\n    if (!email || !email.includes("@")) return false;'
  );
}

// Remove early 40-batch if present
t = t.replace(
  /const IMPORT_BATCH_LIMIT = 40;\s*let rows = await getPendingRows\(ws\);\s*const totalPending = rows\.length;\s*if \(rows\.length > IMPORT_BATCH_LIMIT\) \{[\s\S]*?\}\n/,
  "let rows = await getPendingRows(ws);\n"
);

t = t.replace(
  "const rows = await getPendingRows(ws);",
  "let rows = await getPendingRows(ws);"
);

t = t.replace("const toInsert: any[] = [];", "let toInsert: any[] = [];");

const BATCH_BLOCK = `  // IMPORT_BATCH_LIMIT_AFTER — only NEW rows, then cap per request\n  let remainingNew = 0;\n  const IMPORT_BATCH_LIMIT = 500;\n  if (toInsert.length > IMPORT_BATCH_LIMIT) {\n    remainingNew = toInsert.length - IMPORT_BATCH_LIMIT;\n    toInsert.length = IMPORT_BATCH_LIMIT;\n    if (typeof sheetUpdates !== "undefined" && sheetUpdates.length > IMPORT_BATCH_LIMIT) {\n      sheetUpdates.length = IMPORT_BATCH_LIMIT;\n    }\n    imported = toInsert.length;\n    console.log(\n      "[SHEETS] batch " + IMPORT_BATCH_LIMIT + " inserted, remaining " + remainingNew\n    );\n  }\n\n  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {`;

t = t.replace(
  /\/\/ IMPORT_BATCH_LIMIT_AFTER[\s\S]*?for \(let i = 0; i < toInsert\.length; i \+= INSERT_CHUNK\) \{/,
  BATCH_BLOCK
);

if (!t.includes("remainingNew")) {
  const marker = "  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {";
  if (t.includes(marker)) {
    t = t.replace(marker, BATCH_BLOCK);
    console.log("patch-import: batch block inserted");
  }
}

if (!t.includes("hasMore: remainingNew") && !t.includes("hasMore:")) {
  const oldMsg = `    message: \`Imported \${imported} from "\${cfg.name}" (ws=\${ws}), skipped \${skipped}\${
      errors.length ? \`, errors \${errors.length}\` : ""
    } in \${Math.round(ms / 100) / 10}s\`,
  };`;
  const newMsg = `    remaining: typeof remainingNew === "number" ? remainingNew : 0,
    hasMore: (typeof remainingNew === "number" ? remainingNew : 0) > 0,
    pendingFound: rows.length,
    message:
      imported === 0 && skipped === 0
        ? \`No importable rows on "\${cfg.name}" (ws=\${ws}). Need Email column + Status not Sent/Failed. Check GOOGLE_SHEET_ID / GOOGLE_SHEET_NAME env.\`
        : \`Imported \${imported} from "\${cfg.name}" (ws=\${ws}), skipped \${skipped}\${
            (typeof remainingNew === "number" && remainingNew > 0) ? \`, remaining \${remainingNew}\` : ""
          }\${
            errors.length ? \`, errors \${errors.length}\` : ""
          } in \${Math.round(ms / 100) / 10}s\`,
  };`;
  if (t.includes("Imported ${imported} from")) {
    // already has template - try replace via simpler anchor
  }
  if (t.includes(oldMsg)) {
    t = t.replace(oldMsg, newMsg);
    console.log("patch-import: message updated");
  }
}

if (!t.includes("let remainingNew") && !t.includes("remainingNew = 0")) {
  if (t.includes("let toInsert: any[] = [];")) {
    t = t.replace(
      "let toInsert: any[] = [];",
      "let remainingNew = 0;\n  let toInsert: any[] = [];"
    );
  } else {
    t = t.replace(
      "const toInsert: any[] = [];",
      "let remainingNew = 0;\n  let toInsert: any[] = [];"
    );
  }
}

fs.writeFileSync(p, t);
console.log("patch-import-status: applied");
