#!/usr/bin/env node
/**
 * Sandeer auto sheet + shared Manual Sent Log for all workspaces.
 * Auto: 1bXYe8aiJsL_6X45N_Bwe_OQG1TTUiVhXU4uhdcbbAsg / tab "sheet 1"
 * Manual: 1OPKn3J8oJqTyZ-8OzY5-t-Qx-QV3ySuuCX94qEtnyjU
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "services",
  "googleSheets.ts"
);
if (!fs.existsSync(FILE)) {
  console.log("skip googleSheets");
  process.exit(0);
}
let t = fs.readFileSync(FILE, "utf8");

const SANDEER_ID = "1bXYe8aiJsL_6X45N_Bwe_OQG1TTUiVhXU4uhdcbbAsg";
const SANDEER_TAB = "sheet 1";
const MANUAL_ID = "1OPKn3J8oJqTyZ-8OzY5-t-Qx-QV3ySuuCX94qEtnyjU";

if (!t.includes("SANDEER_WORKSPACE")) {
  t = t.replace(
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, workspaceSql } from "@/lib/workspace";',
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE, workspaceSql } from "@/lib/workspace";'
  );
}

// Force Sandeer sheet constants (replace empty or any previous value)
if (t.includes("SANDEER_SHEET_ID")) {
  t = t.replace(
    /const SANDEER_SHEET_ID\s*=\s*[^;]+;/,
    `const SANDEER_SHEET_ID = process.env.GOOGLE_SHEET_ID_SANDEER || "${SANDEER_ID}";`
  );
  t = t.replace(
    /const SANDEER_SHEET_NAME\s*=\s*[^;]+;|const SANDEER_SHEET_NAME\s*=\s*\n\s*process\.env\.GOOGLE_SHEET_NAME_SANDEER[^;]+;/,
    `const SANDEER_SHEET_NAME = process.env.GOOGLE_SHEET_NAME_SANDEER || "${SANDEER_TAB}";`
  );
  // multi-line form
  t = t.replace(
    /const SANDEER_SHEET_NAME\s*=\s*\n\s*process\.env\.GOOGLE_SHEET_NAME_SANDEER \|\| "[^"]*";/,
    `const SANDEER_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_SANDEER || "${SANDEER_TAB}";`
  );
} else {
  t = t.replace(
    `const AMAZON_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_AMAZON || "Amazon";

const MANUAL_SHEET_ID`,
    `const AMAZON_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_AMAZON || "Amazon";

const SANDEER_SHEET_ID =
  process.env.GOOGLE_SHEET_ID_SANDEER || "${SANDEER_ID}";
const SANDEER_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_SANDEER || "${SANDEER_TAB}";

const MANUAL_SHEET_ID`
  );
}

// Shared Manual Sent Log for ALL workspaces
t = t.replace(
  /const MANUAL_SHEET_ID\s*=\s*process\.env\.GOOGLE_MANUAL_LOG_SHEET_ID \|\| "[^"]*";/,
  `const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID || "${MANUAL_ID}";`
);
t = t.replace(
  /const MANUAL_SHEET_ID\s*=\s*process\.env\.GOOGLE_MANUAL_LOG_SHEET_ID \|\| "";/,
  `const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID || "${MANUAL_ID}";`
);

if (!t.includes('w === SANDEER_WORKSPACE') && !t.includes('w === "sandeer"')) {
  t = t.replace(
    `  if (w === AMAZON_WORKSPACE || w === "amazon") {
    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };
  }
  return { id: SHEET_ID, name: SHEET_NAME };`,
    `  if (w === AMAZON_WORKSPACE || w === "amazon") {
    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };
  }
  if (w === SANDEER_WORKSPACE || w === "sandeer") {
    return { id: SANDEER_SHEET_ID, name: SANDEER_SHEET_NAME };
  }
  return { id: SHEET_ID, name: SHEET_NAME };`
  );
}

if (!t.includes("SANDEER_WORKSPACE]")) {
  t = t.replace(
    ": [MAIN_WORKSPACE, AMAZON_WORKSPACE];",
    ": [MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE];"
  );
}

fs.writeFileSync(FILE, t);
console.log(
  "patch-sandeer-sheets:",
  "sandeerId=",
  t.includes(SANDEER_ID),
  "manualId=",
  t.includes(MANUAL_ID),
  "tab=",
  t.includes(SANDEER_TAB)
);
