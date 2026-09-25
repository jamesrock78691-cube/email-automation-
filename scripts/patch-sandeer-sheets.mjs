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

if (!t.includes("w === SANDEER_WORKSPACE")) {
  t = t.replace(
    '  if (w === AMAZON_WORKSPACE || w === "amazon") {\n    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };\n  }\n  return { id: SHEET_ID, name: SHEET_NAME };',
    '  if (w === AMAZON_WORKSPACE || w === "amazon") {\n    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };\n  }\n  if (w === SANDEER_WORKSPACE || w === "sandeer") {\n    return { id: SANDEER_SHEET_ID, name: SANDEER_SHEET_NAME };\n  }\n  return { id: SHEET_ID, name: SHEET_NAME };'
  );
}

const NEW_GET =
  "async function getManualSheet() {\n" +
  "  if (!MANUAL_SHEET_ID) {\n" +
  '    throw new Error("GOOGLE_MANUAL_LOG_SHEET_ID is missing in Vercel env");\n' +
  "  }\n" +
  "  const jwt = ensureAuth();\n" +
  "  if (!manualDoc) {\n" +
  "    manualDoc = new GoogleSpreadsheet(MANUAL_SHEET_ID, jwt);\n" +
  "  }\n" +
  "  await manualDoc.loadInfo();\n" +
  "  manualInitialized = true;\n" +
  "  const titles = Object.keys(manualDoc.sheetsByTitle || {});\n" +
  "  const candidates = [\n" +
  "    MANUAL_SHEET_NAME,\n" +
  '    "Manual Sent Log",\n' +
  '    "Manual_Sent_Log",\n' +
  '    "Manual Sent",\n' +
  '    "Sheet1",\n' +
  "  ];\n" +
  "  for (const name of candidates) {\n" +
  "    if (!name) continue;\n" +
  "    const sheet = manualDoc.sheetsByTitle[name];\n" +
  "    if (sheet) {\n" +
  '      console.log("[MANUAL SHEET] using tab=" + name + " available=" + titles.join(","));\n' +
  "      return sheet;\n" +
  "    }\n" +
  "  }\n" +
  "  for (const title of titles) {\n" +
  "    if (candidates.some((c) => c && c.toLowerCase() === title.toLowerCase())) {\n" +
  "      return manualDoc.sheetsByTitle[title];\n" +
  "    }\n" +
  "  }\n" +
  "  throw new Error(\n" +
  '    "Manual sheet tab not found. Tried: " +\n' +
  '      candidates.join(", ") +\n' +
  '      ". Available: " +\n' +
  '      (titles.join(", ") || "(none)")\n' +
  "  );\n" +
  "}\n";

if (t.includes("async function getManualSheet()")) {
  t = t.replace(
    /async function getManualSheet\(\) \{[\s\S]*?\n\}\n\n/,
    NEW_GET + "\n"
  );
  console.log("getManualSheet replaced");
}

t = t.replace(
  /const tryWs = preferredWs\s*\?\s*\[preferredWs\]\s*:\s*\[[^\]]+\];/,
  "const tryWs = preferredWs\n    ? [String(preferredWs).toLowerCase(), MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE].filter((w, i, a) => w && a.indexOf(w) === i)\n    : [MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE];"
);

while (t.includes("if (tid !== id) continue;")) {
  t = t.replace(
    "if (tid !== id) continue;",
    "if (!tid || tid.toLowerCase() !== id.toLowerCase()) continue;"
  );
}

t = t.replaceAll(
  'pick("Tracking ID", "tracking_id", "Tracking Id")',
  'pick("Tracking ID", "tracking_id", "Tracking Id", "tracking id", "TrackingID")'
);

if (!t.includes("[OPEN MANUAL]")) {
  t = t.replace(
    "const sheet = await getManualSheet();\n    const rows = await sheet.getRows();\n    const id = String(trackingId).trim();",
    'const sheet = await getManualSheet();\n    const rows = await sheet.getRows();\n    const id = String(trackingId).trim();\n    console.log("[OPEN MANUAL] rows=" + rows.length + " looking for " + id);'
  );
}

const OLD_INNER =
  "      if (!cfg.id || !trackingId) continue;\n" +
  "      const sheet = await getAutoSheet(ws);\n" +
  "      const rows = await sheet.getRows();\n" +
  "      const id = String(trackingId).trim();\n" +
  "      const openedAt = openedAtIso || new Date().toISOString();";

const NEW_INNER =
  "      if (!cfg.id || !trackingId) continue;\n" +
  "      const id = String(trackingId).trim();\n" +
  "      const openedAt = openedAtIso || new Date().toISOString();\n" +
  "      const sheet = await getAutoSheet(ws, { refresh: true });\n" +
  "      const rows = await sheet.getRows();\n" +
  '      console.log("[OPEN SHEET] ws=" + ws + " rows=" + rows.length + " looking for " + id);';

if (t.includes(OLD_INNER)) {
  t = t.replace(OLD_INNER, NEW_INNER);
  console.log("auto open inner replaced");
}

fs.writeFileSync(FILE, t);
console.log(
  "done",
  t.includes(SANDEER_ID),
  t.includes(MANUAL_ID),
  t.includes("toLowerCase() !== id.toLowerCase()"),
  t.includes("[OPEN MANUAL]"),
  t.includes("[MANUAL SHEET]")
);
