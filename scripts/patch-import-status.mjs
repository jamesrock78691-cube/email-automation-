#!/usr/bin/env node
/**
 * Deep import fix for admin/main + all workspaces:
 * - Importable statuses include blank/pending/imported
 * - Fuzzy Email column detection
 * - When 0 imported: return status breakdown so UI shows real reason
 * - Batch 500 + hasMore
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

// --- Fuzzy email in readRows mapping ---
const OLD_EMAIL_PICK =
  'email: pick(row, "Email", "email", "E-mail", "email address", "to"),';
const NEW_EMAIL_PICK = `email: (() => {
      const direct = pick(row, "Email", "email", "E-mail", "email address", "to", "Email Address", "EMAIL");
      if (direct && direct.includes("@")) return direct;
      try {
        const obj = row.toObject ? row.toObject() : {};
        for (const [hk, hv] of Object.entries(obj)) {
          const key = String(hk).toLowerCase().replace(/[_\\s]+/g, " ").trim();
          const val = String(hv ?? "").trim();
          if (val.includes("@") && (key.includes("email") || key === "to" || key === "e-mail")) {
            return val;
          }
        }
        for (const hv of Object.values(obj)) {
          const val = String(hv ?? "").trim();
          if (val.includes("@") && val.includes(".") && val.length < 120) return val;
        }
      } catch {}
      return direct || "";
    })(),`;

if (t.includes(OLD_EMAIL_PICK)) {
  t = t.replace(OLD_EMAIL_PICK, NEW_EMAIL_PICK);
  console.log("patch-import: fuzzy email pick");
}

// --- getPendingRows: terminal-only skip ---
t = t.replace(
  '["sent", "failed", "imported", "done", "completed"]',
  '["sent", "failed", "done", "completed", "success"]'
);
t = t.replace(
  '["sent", "failed", "done", "completed"]',
  '["sent", "failed", "done", "completed", "success"]'
);

if (!t.includes('!email.includes("@")')) {
  t = t.replace(
    'const email = (row.email || "").trim();\n    if (!email) return false;',
    'const email = (row.email || "").trim();\n    if (!email || !email.includes("@")) return false;'
  );
}

t = t.replace(
  /const IMPORT_BATCH_LIMIT = 40;\s*let rows = await getPendingRows\(ws\);\s*const totalPending = rows\.length;\s*if \(rows\.length > IMPORT_BATCH_LIMIT\) \{[\s\S]*?\}\n/,
  "let rows = await getPendingRows(ws);\n"
);
t = t.replace(
  "const rows = await getPendingRows(ws);",
  "let rows = await getPendingRows(ws);"
);
t = t.replace("const toInsert: any[] = [];", "let toInsert: any[] = [];");

const BATCH_BLOCK2 = `  // IMPORT_BATCH_LIMIT_AFTER\n  let remainingNew = 0;\n  const IMPORT_BATCH_LIMIT = 500;\n  if (toInsert.length > IMPORT_BATCH_LIMIT) {\n    remainingNew = toInsert.length - IMPORT_BATCH_LIMIT;\n    toInsert.length = IMPORT_BATCH_LIMIT;\n    if (typeof sheetUpdates !== "undefined" && sheetUpdates.length > IMPORT_BATCH_LIMIT) {\n      sheetUpdates.length = IMPORT_BATCH_LIMIT;\n    }\n    imported = toInsert.length;\n    console.log("[SHEETS] batch " + IMPORT_BATCH_LIMIT + " remaining " + remainingNew);\n  }\n\n  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {`;

t = t.replace(
  /\/\/ IMPORT_BATCH_LIMIT_AFTER[\s\S]*?for \(let i = 0; i < toInsert\.length; i \+= INSERT_CHUNK\) \{/,
  BATCH_BLOCK2
);

if (!t.includes("remainingNew")) {
  const marker = "  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {";
  if (t.includes(marker)) {
    t = t.replace(marker, BATCH_BLOCK2);
  }
}

if (!t.includes("let remainingNew") && !t.includes("remainingNew = 0")) {
  t = t.replace(
    "let toInsert: any[] = [];",
    "let remainingNew = 0;\n  let toInsert: any[] = [];"
  );
}

const DIAG = `
  // Diagnostic when nothing new imported
  if (imported === 0) {
    try {
      const allRows = await readRows(ws);
      const statusCounts: Record<string, number> = {};
      let withEmail = 0;
      for (const r of allRows) {
        const st = String(r.status || "(blank)").trim().toLowerCase() || "(blank)";
        statusCounts[st] = (statusCounts[st] || 0) + 1;
        if (r.email && String(r.email).includes("@")) withEmail++;
      }
      const cfg2 = resolveSheetConfig(ws);
      const diag =
        "sheet=" +
        (cfg2.name || "?") +
        " totalRows=" +
        allRows.length +
        " withEmail=" +
        withEmail +
        " statuses=" +
        JSON.stringify(statusCounts) +
        " pendingCandidates=" +
        rows.length +
        " skipped=" +
        skipped;
      console.warn("[SHEETS IMPORT DIAG]", diag);
      errors.push(diag);
    } catch (diagErr: any) {
      errors.push("diag failed: " + (diagErr?.message || diagErr));
    }
  }
`;

if (!t.includes("[SHEETS IMPORT DIAG]")) {
  t = t.replace(
    "  const ms = Date.now() - t0;\n  const cfg = resolveSheetConfig(ws);",
    DIAG + "\n  const ms = Date.now() - t0;\n  const cfg = resolveSheetConfig(ws);"
  );
  console.log("patch-import: diag block added");
}

if (!t.includes("No importable rows on") && !t.includes("No new rows (ws=")) {
  t = t.replace(
    /message: `Imported \$\{imported\} from "\$\{cfg\.name\}" \(ws=\$\{ws\}\), skipped \$\{skipped\}[\s\S]*?in \$\{Math\.round\(ms \/ 100\) \/ 10\}s`,\n  \};/,
    `remaining: typeof remainingNew === "number" ? remainingNew : 0,
    hasMore: (typeof remainingNew === "number" ? remainingNew : 0) > 0,
    pendingFound: rows.length,
    message:
      imported === 0
        ? (errors[0] || \`No new rows (ws=\${ws} sheet=\${cfg.name}). skipped=\${skipped}. Clear queue or add new sheet rows / set Status blank.\`)
        : \`Imported \${imported} from "\${cfg.name}" (ws=\${ws}), skipped \${skipped}\${
            (typeof remainingNew === "number" && remainingNew > 0) ? \`, remaining \${remainingNew}\` : ""
          } in \${Math.round(ms / 100) / 10}s\`,
  };`
  );
}

fs.writeFileSync(p, t);
console.log("patch-import-status: deep fix applied");
