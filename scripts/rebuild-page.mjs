#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "page_b64");
const parts = fs.readdirSync(dir).filter((f) => f.startsWith("part") && f.endsWith(".txt")).sort((a, b) => {
  const na = parseInt(a.replace(/\D/g, ""), 10);
  const nb = parseInt(b.replace(/\D/g, ""), 10);
  return na - nb;
});
let b64 = "";
for (const p of parts) {
  b64 += fs.readFileSync(path.join(dir, p), "utf8").trim();
}
const buf = Buffer.from(b64, "base64");
const out = path.join(__dirname, "..", "src", "app", "page.tsx");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log("Rebuilt page.tsx from", parts.length, "parts,", buf.length, "bytes");
