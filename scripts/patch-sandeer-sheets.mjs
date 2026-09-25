#!/usr/bin/env node
/** Sandeer sheet + robust open-count updates on Google Sheets. */
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

// try all workspaces (preferred first)
t = t.replace(
  /const tryWs = preferredWs\s*\?\s*\[preferredWs\]\s*:\s*\[[^\]]+\];/,
  "const tryWs = preferredWs\n    ? [String(preferredWs).toLowerCase(), MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE].filter((w, i, a) => w && a.indexOf(w) === i)\n    : [MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE];"
);

// Replace the inner block that loads sheet + matches tracking id
const OLD_INNER =
  "      if (!cfg.id || !trackingId) continue;\n" +
  "      const sheet = await getAutoSheet(ws);\n" +
  "      const rows = await sheet.getRows();\n" +
  "      const id = String(trackingId).trim();\n" +
  "      const openedAt = openedAtIso || new Date().toISOString();\n\n" +
  "      for (const row of rows as any[]) {\n" +
  "        const pick = (...keys: string[]) => {\n" +
  "          for (const k of keys) {\n" +
  "            const v = row.get(k);\n" +
  "            if (v !== undefined && v !== null && String(v).trim() !== \"\") {\n" +
  "              return String(v).trim();\n" +
  "            }\n" +
  "          }\n" +
  "          return \"\";\n" +
  "        };\n" +
  "        const tid = pick(\"Tracking ID\", \"tracking_id\", \"Tracking Id\");\n" +
  "        if (tid !== id) continue;\n\n" +
  "        const prev = parseInt(pick(\"Open Count\", \"open_count\") || \"0\", 10);\n" +
  "        const next = (Number.isFinite(prev) ? prev : 0) + 1;\n" +
  "        row.set(\"Open Count\", String(next));\n" +
  "        row.set(\"Opened At\", openedAt);\n" +
  "        await row.save();";

const NEW_INNER =
  "      if (!cfg.id || !trackingId) continue;\n" +
  "      const id = String(trackingId).trim();\n" +
  "      const openedAt = openedAtIso || new Date().toISOString();\n" +
  "      const sheet = await getAutoSheet(ws, { refresh: true });\n" +
  "      const rows = await sheet.getRows();\n" +
  "      console.log(`[OPEN SHEET] ws=${ws} rows=${rows.length} looking for ${id}`);\n\n" +
  "      for (const row of rows as any[]) {\n" +
  "        const pick = (...keys: string[]) => {\n" +
  "          for (const k of keys) {\n" +
  "            try {\n" +
  "              const v = row.get(k);\n" +
  "              if (v !== undefined && v !== null && String(v).trim() !== \"\") {\n" +
  "                return String(v).trim();\n" +
  "              }\n" +
  "            } catch {}\n" +
  "          }\n" +
  "          return \"\";\n" +
  "        };\n" +
  "        const tid = pick(\n" +
  "          \"Tracking ID\",\n" +
  "          \"tracking_id\",\n" +
  "          \"Tracking Id\",\n" +
  "          \"tracking id\",\n" +
  "          \"TrackingID\",\n" +
  "          \"TRACKING ID\"\n" +
  "        );\n" +
  "        if (!tid || tid.toLowerCase() !== id.toLowerCase()) continue;\n\n" +
  "        const prev = parseInt(\n" +
  "          pick(\"Open Count\", \"open_count\", \"OpenCount\", \"opens\", \"Opens\") || \"0\",\n" +
  "          10\n" +
  "        );\n" +
  "        const next = (Number.isFinite(prev) ? prev : 0) + 1;\n" +
  "        const setField = (aliases: string[], value: string) => {\n" +
  "          for (const a of aliases) {\n" +
  "            try {\n" +
  "              const cur = row.get(a);\n" +
  "              if (cur !== undefined && cur !== null) {\n" +
  "                row.set(a, value);\n" +
  "                return;\n" +
  "              }\n" +
  "            } catch {}\n" +
  "          }\n" +
  "          try {\n" +
  "            row.set(aliases[0], value);\n" +
  "          } catch {}\n" +
  "        };\n" +
  "        setField([\"Open Count\", \"open_count\", \"OpenCount\", \"opens\", \"Opens\"], String(next));\n" +
  "        setField([\"Opened At\", \"opened_at\", \"OpenedAt\"], openedAt);\n" +
  "        await row.save();\n" +
  "        console.log(`[OPEN SHEET] UPDATED ws=${ws} id=${id} count=${next}`);";

if (t.includes(OLD_INNER)) {
  t = t.replace(OLD_INNER, NEW_INNER);
  console.log("open inner block replaced");
} else if (!t.includes("[OPEN SHEET] UPDATED")) {
  // already partially patched — apply piece by piece
  t = t.replace(
    "if (tid !== id) continue;",
    "if (!tid || tid.toLowerCase() !== id.toLowerCase()) continue;"
  );
  t = t.replace(
    "const sheet = await getAutoSheet(ws);\n      const rows = await sheet.getRows();\n      const id = String(trackingId).trim();",
    "const id = String(trackingId).trim();\n      const sheet = await getAutoSheet(ws, { refresh: true });\n      const rows = await sheet.getRows();\n      console.log(`[OPEN SHEET] ws=${ws} rows=${rows.length} looking for ${id}`);"
  );
  console.log("open inner partial patch");
} else {
  console.log("open block already robust");
}

fs.writeFileSync(FILE, t);
console.log(
  "done",
  t.includes(SANDEER_ID),
  t.includes("[OPEN SHEET]"),
  t.includes("toLowerCase() !== id.toLowerCase()")
);
