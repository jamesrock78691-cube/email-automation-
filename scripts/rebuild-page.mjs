#!/usr/bin/env node
/**
 * Restores src/app/page.tsx from last known-good commit (CDN),
 * then injects attachment base64 + auth headers for workspace isolation.
 * IMPORTANT: never leave two "headers:" keys in the same object literal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@a92fad723695c11bb1909753ad026eb75e1c76fd/src/app/page.tsx";
const OUT = path.join(__dirname, "..", "src", "app", "page.tsx");

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function patch(text, oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip (not found):", label);
    return text;
  }
  const count = text.split(oldStr).length - 1;
  text = text.split(oldStr).join(newStr);
  console.log(`Patched (${count}x):`, label);
  return text;
}

try {
  let text = await fetchText(SOURCE);
  if (!text.includes("EmailAutomationDashboard")) {
    throw new Error("Downloaded page looks invalid");
  }

  // 1) Template attachment stores contentBase64
  text = patch(
    text,
    `    existing.push({
      filename: data.filename,
      originalName: data.originalName,
      path: data.path,
    });`,
    `    existing.push({
      filename: data.filename,
      originalName: data.originalName,
      path: data.path,
      contentType: data.contentType || undefined,
      size: data.size || undefined,
      contentBase64: data.contentBase64 || undefined,
    });`,
    "contentBase64 attachment"
  );

  // 2) Gmail save — Bearer token
  text = patch(
    text,
    `      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gmailForm),
      });`,
    `      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(gmailForm),
      });`,
    "gmail save authHeaders"
  );

  // 3) Queue actions — replace FULL header+body block (avoids duplicate headers key)
  // Matches both 8-space and 12-space indent variants of process_next
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "process_next" }),`,
    `headers: authHeaders(),
            body: JSON.stringify({ action: "process_next" }),`,
    "process_next auth (12-space)"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_next" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "process_next" }),`,
    "process_next auth (8-space)"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process_batch" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "process_batch" }),`,
    "process_batch auth"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_all" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "reset_all" }),`,
    "reset_all auth"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_all" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "clear_all" }),`,
    "clear_all auth"
  );

  // 4) Safety: strip any accidental double-headers left from older patch logic
  text = text.replace(
    /headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}\s*,\s*\n\s*headers:\s*authHeaders\(\)/g,
    "headers: authHeaders()"
  );
  // Also: headers on same line as body from bad partial patch
  text = text.replace(
    /headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}\s*,\s*\n\s*headers:\s*authHeaders\(\),\s*body:/g,
    "headers: authHeaders(),\n        body:"
  );

  // 5) Gmail delete with auth
  text = patch(
    text,
    `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE" });`,
    `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE", headers: authHeaders() });`,
    "gmail delete auth"
  );

  // 6) Campaign load with auth
  text = patch(
    text,
    `const cRes = await fetch("/api/campaign");`,
    `const cRes = await fetch("/api/campaign", { headers: authHeaders() });`,
    "campaign list auth"
  );

  // Final guard: fail build if duplicate headers still present in object literals
  if (/headers:\s*\{[^}]*\}\s*,\s*\n\s*headers:\s*/.test(text)) {
    console.error("FATAL: duplicate headers key still present in page.tsx");
    process.exit(1);
  }
  if (/headers:\s*authHeaders\(\),\s*body:.*\n\s*headers:/.test(text)) {
    console.error("FATAL: headers+body then another headers");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("Wrote", OUT, text.length, "bytes");
} catch (err) {
  console.error("rebuild-page failed:", err?.message || err);
  if (!fs.existsSync(OUT)) process.exit(1);
  throw err;
}
