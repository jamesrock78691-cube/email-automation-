#!/usr/bin/env node
/** Sandeer auto sheet + Manual log open tracking fixes. */
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
const SANDEER_TAB = "Sheet1";
const MANUAL_ID = "1OPKn3J8oJqTyZ-8OzY5-t-Qx-QV3ySuuCX94qEtnyjU";

if (!t.includes("SANDEER_WORKSPACE")) {
  t = t.replace(
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, workspaceSql } from "@/lib/workspace";',
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE, workspaceSql } from "@/lib/workspace";'
  );
}

if (!t.includes(SANDEER_ID)) {
  if (t.includes("SANDEER_SHEET_ID")) {
    t = t.replace(
      /const SANDEER_SHEET_ID[\s\S]*?;/,
      'const SANDEER_SHEET_ID = process.env.GOOGLE_SHEET_ID_SANDEER || "' +
        SANDEER_ID +
        '";'
    );
    t = t.replace(
      /const SANDEER_SHEET_NAME[\s\S]*?;/,
      'const SANDEER_SHEET_NAME = process.env.GOOGLE_SHEET_NAME_SANDEER || "' +
        SANDEER_TAB +
        '";'
    );
  } else {
    t = t.replace(
      "const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID",
      'const SANDEER_SHEET_ID = process.env.GOOGLE_SHEET_ID_SANDEER || "' +
        SANDEER_ID +
        '";\n' +
        'const SANDEER_SHEET_NAME = process.env.GOOGLE_SHEET_NAME_SANDEER || "' +
        SANDEER_TAB +
        '";\n\n' +
        "const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID"
    );
  }
} else {
  t = t.replace(
    /GOOGLE_SHEET_NAME_SANDEER \|\| "[^"]*"/,
    'GOOGLE_SHEET_NAME_SANDEER || "' + SANDEER_TAB + '"'
  );
}

t = t.replace(
  /const MANUAL_SHEET_ID = process\.env\.GOOGLE_MANUAL_LOG_SHEET_ID \|\| "[^"]*";/,
  'const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID || "' +
    MANUAL_ID +
    '";'
);

// Also allow common tab name aliases via env default list in getManualSheet
if (!t.includes("MANUAL_TAB_CANDIDATES")) {
  t = t.replace(
    'const MANUAL_SHEET_NAME =\n  process.env.GOOGLE_MANUAL_LOG_SHEET_NAME || "Manual Sent Log";',
    'const MANUAL_SHEET_NAME =\n  process.env.GOOGLE_MANUAL_LOG_SHEET_NAME || "Manual Sent Log";\nconst MANUAL_TAB_CANDIDATES = [\n  MANUAL_SHEET_NAME,\n  "Manual Sent Log",\n  "Manual_Sent_Log",\n  "Manual Sent",\n  "manual sent log",\n  "Sheet1",\n];'
  );
  // single-line form
  t = t.replace(
    'const MANUAL_SHEET_NAME =\n  process.env.GOOGLE_MANUAL_LOG_SHEET_NAME || "Manual Sent Log";',
    'const MANUAL_SHEET_NAME = process.env.GOOGLE_MANUAL_LOG_SHEET_NAME || "Manual Sent Log";\nconst MANUAL_TAB_CANDIDATES = [MANUAL_SHEET_NAME, "Manual Sent Log", "Manual_Sent_Log", "Manual Sent", "Sheet1"];'
  );
}

if (!t.includes("w === SANDEER_WORKSPACE")) {
  t = t.replace(
    '  if (w === AMAZON_WORKSPACE || w === "amazon") {\n    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };\n  }\n  return { id: SHEET_ID, name: SHEET_NAME };',
    '  if (w === AMAZON_WORKSPACE || w === "amazon") {\n    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };\n  }\n  if (w === SANDEER_WORKSPACE || w === "sandeer") {\n    return { id: SANDEER_SHEET_ID, name: SANDEER_SHEET_NAME };\n  }\n  return { id: SHEET_ID, name: SHEET_NAME };'
  );
}

// getManualSheet — try multiple tab names
const OLD_GET_MANUAL = `async function getManualSheet() {
  if (!MANUAL_SHEET_ID) {
    throw new Error("GOOGLE_MANUAL_LOG_SHEET_ID is missing in Vercel env");
  }
  const jwt = ensureAuth();
  if (!manualDoc) {
    manualDoc = new GoogleSpreadsheet(MANUAL_SHEET_ID, jwt);
  }
  if (!manualInitialized) {
    await manualDoc.loadInfo();
    manualInitialized = true;
  }
  const sheet = manualDoc.sheetsByTitle[MANUAL_SHEET_NAME];
  if (!sheet) {
    throw new Error(\`Sheet tab "\${MANUAL_SHEET_NAME}" not found.\`);
  }
  return sheet;
}`;

const NEW_GET_MANUAL = `async function getManualSheet() {
  if (!MANUAL_SHEET_ID) {
    throw new Error("GOOGLE_MANUAL_LOG_SHEET_ID is missing in Vercel env");
  }
  const jwt = ensureAuth();
  if (!manualDoc) {
    manualDoc = new GoogleSpreadsheet(MANUAL_SHEET_ID, jwt);
  }
  await manualDoc.loadInfo();
  manualInitialized = true;
  const titles = Object.keys(manualDoc.sheetsByTitle || {});
  const candidates = [
    MANUAL_SHEET_NAME,
    "Manual Sent Log",
    "Manual_Sent_Log",
    "Manual Sent",
    "Sheet1",
  ];
  for (const name of candidates) {
    if (!name) continue;
    const sheet = manualDoc.sheetsByTitle[name];
    if (sheet) {
      console.log(\`[MANUAL SHEET] using tab="\${name}\