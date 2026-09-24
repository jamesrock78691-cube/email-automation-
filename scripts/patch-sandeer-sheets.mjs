#!/usr/bin/env node
/** Ensure googleSheets.ts routes sandeer workspace to its own sheet. */
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

if (!t.includes("SANDEER_WORKSPACE")) {
  t = t.replace(
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, workspaceSql } from "@/lib/workspace";',
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE, workspaceSql } from "@/lib/workspace";'
  );
}

if (!t.includes("SANDEER_SHEET_ID")) {
  t = t.replace(
    `const AMAZON_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_AMAZON || "Amazon";

const MANUAL_SHEET_ID`,
    `const AMAZON_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_AMAZON || "Amazon";

const SANDEER_SHEET_ID = process.env.GOOGLE_SHEET_ID_SANDEER || "";
const SANDEER_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_SANDEER || "Sandeer";

const MANUAL_SHEET_ID`
  );
}

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

if (!t.includes("GOOGLE_SHEET_ID_SANDEER missing")) {
  t = t.replace(
    `ws === AMAZON_WORKSPACE
        ? "Amazon GOOGLE_SHEET_ID_AMAZON missing"
        : "GOOGLE_SHEET_ID is missing in Vercel env"`,
    `ws === AMAZON_WORKSPACE
        ? "Amazon GOOGLE_SHEET_ID_AMAZON missing"
        : ws === SANDEER_WORKSPACE || ws === "sandeer"
          ? "Sandeer GOOGLE_SHEET_ID_SANDEER missing — set in Vercel env"
          : "GOOGLE_SHEET_ID is missing in Vercel env"`
  );
}

if (!t.includes("SANDEER_WORKSPACE]")) {
  t = t.replace(
    ": [MAIN_WORKSPACE, AMAZON_WORKSPACE];",
    ": [MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE];"
  );
}

fs.writeFileSync(FILE, t);
console.log("patch-sandeer-sheets done", t.includes("SANDEER_SHEET_ID"));
