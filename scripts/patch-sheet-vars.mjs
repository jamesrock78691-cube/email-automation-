#!/usr/bin/env node
/** Ensure Google Sheet columns map to template vars correctly. */
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

const OLD = `    referenceNo: pick(row, "reference_no", "Reference No", "Reference", "ref"),
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

const NEW = `    // {{name}} ← sheet column "name" (stored in queue.referenceNo)
    referenceNo: pick(
      row,
      "name",
      "Name",
      "reference_no",
      "Reference No",
      "Reference",
      "ref"
    ),
    serialNo: pick(row, "serial_no", "Serial No", "Serial", "serial"),
    // {{mark_name}} ← sheet column mark_name only (never merge with name)
    markName: pick(row, "mark_name", "Mark Name", "Mark", "trademark"),`;

if (text.includes(OLD)) {
  text = text.replace(OLD, NEW);
  fs.writeFileSync(FILE, text);
  console.log("Patched sheet column mapping: name + mark_name");
} else if (text.includes('pick(row, "name"') && text.includes("mark_name")) {
  console.log("Sheet mapping already correct");
} else {
  // broader replace for markName block that still includes name
  const re =
    /markName:\s*pick\(\s*row,\s*"mark_name",\s*"Mark Name",\s*"Mark",\s*"trademark",\s*"name",\s*"Name"\s*\)/;
  if (re.test(text)) {
    text = text.replace(
      re,
      'markName: pick(row, "mark_name", "Mark Name", "Mark", "trademark")'
    );
    text = text.replace(
      /referenceNo:\s*pick\(row,\s*"reference_no",\s*"Reference No",\s*"Reference",\s*"ref"\)/,
      'referenceNo: pick(row, "name", "Name", "reference_no", "Reference No", "Reference", "ref")'
    );
    fs.writeFileSync(FILE, text);
    console.log("Patched sheet mapping via regex");
  } else {
    console.log("WARN: could not patch googleSheets mapping");
  }
}
