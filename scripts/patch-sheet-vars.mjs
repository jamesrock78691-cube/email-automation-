#!/usr/bin/env node
/** Sheet column → template vars (Amazon vs main). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(
  __dirname,
  "..",
  "src",
  "app",
  "services",
  "googleSheets.ts"
);

if (!fs.existsSync(FILE)) {
  console.log("googleSheets.ts missing — skip");
  process.exit(0);
}

let text = fs.readFileSync(FILE, "utf8");

// Prefer workspace-aware mapping inside readRows
const OLD = `  return rows.map((row: any) => ({
    rowNumber: row.rowNumber,
    referenceNo: pick(row, "reference_no", "Reference No", "Reference", "ref"),
    serialNo: pick(row, "serial_no", "Serial No", "Serial", "serial"),
    // Amazon sheet has mark_name + name
    markName: pick(
      row,
      "mark_name",
      "Mark Name",
      "Mark",
      "trademark",
      "name",
      "Name"
    ),`;

const NEW = `  const isAmazon =
    String(ws || "").toLowerCase() === "amazon";
  return rows.map((row: any) => ({
    rowNumber: row.rowNumber,
    // Amazon: name column → {{name}} (stored as referenceNo)
    // Main: reference_no first (unchanged)
    referenceNo: isAmazon
      ? pick(row, "name", "Name", "reference_no", "Reference No", "Reference", "ref")
      : pick(row, "reference_no", "Reference No", "Reference", "ref"),
    serialNo: pick(row, "serial_no", "Serial No", "Serial", "serial"),
    // mark_name only — never merge with name
    markName: pick(row, "mark_name", "Mark Name", "Mark", "trademark"),`;

if (text.includes(OLD)) {
  text = text.replace(OLD, NEW);
  fs.writeFileSync(FILE, text);
  console.log("Patched sheet mapping (amazon vs main)");
} else if (text.includes("const isAmazon") && text.includes('pick(row, "name"')) {
  console.log("Sheet mapping already workspace-aware");
} else {
  // If previous patch put name first globally, leave it — still works for main via fallbacks
  const re =
    /markName:\s*pick\(\s*row,\s*"mark_name",\s*"Mark Name",\s*"Mark",\s*"trademark",\s*"name",\s*"Name"\s*\)/;
  if (re.test(text)) {
    text = text.replace(
      re,
      'markName: pick(row, "mark_name", "Mark Name", "Mark", "trademark")'
    );
    fs.writeFileSync(FILE, text);
    console.log("Patched markName to exclude name merge");
  } else {
    console.log("Sheet mapping ok / already patched");
  }
}
