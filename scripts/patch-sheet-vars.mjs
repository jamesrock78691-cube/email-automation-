#!/usr/bin/env node
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
  console.log("skip gs");
  process.exit(0);
}
let t = fs.readFileSync(FILE, "utf8");

// Never merge name into markName
const badMark =
  /markName:\s*pick\(\s*row,\s*"mark_name",\s*"Mark Name",\s*"Mark",\s*"trademark",\s*"name",\s*"Name"\s*\)/;
if (badMark.test(t)) {
  t = t.replace(
    badMark,
    'markName: pick(row, "mark_name", "Mark Name", "Mark", "trademark")'
  );
  console.log("fixed markName (no name merge)");
}

// Amazon: name column → referenceNo (becomes {{name}})
if (!t.includes('pick(row, "name", "Name"')) {
  const before = t;
  t = t.replace(
    /referenceNo:\s*pick\(row,\s*"reference_no",\s*"Reference No",\s*"Reference",\s*"ref"\)/,
    `referenceNo: (String(ws || "").toLowerCase() === "amazon"
      ? pick(row, "name", "Name", "reference_no", "Reference No", "Reference", "ref")
      : pick(row, "reference_no", "Reference No", "Reference", "ref"))`
  );
  if (t !== before) console.log("fixed Amazon name → referenceNo mapping");
  else console.log("WARN: referenceNo pattern not found");
} else {
  console.log("name column mapping already present");
}

fs.writeFileSync(FILE, t);
console.log("googleSheets patched", t.length);
