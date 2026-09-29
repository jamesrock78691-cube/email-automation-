#!/usr/bin/env node
/**
 * Restores page.tsx + force auth on Live Sheet import (no more fake Check .env).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "app", "page.tsx");
const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@a92fad723695c11bb1909753ad026eb75e1c76fd/src/app/page.tsx";

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

let text = await (await fetch(SOURCE, { redirect: "follow" })).text();
if (!text.includes("EmailAutomationDashboard")) {
  throw new Error("Downloaded page looks invalid");
}

// Force every /api/queue import call to use authHeaders()
text = text.replace(
  /fetch\(\s*["']\/api\/queue["']\s*,\s*\{\s*method:\s*["']POST["']\s*,\s*headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}\s*,\s*body:\s*JSON\.stringify\(\s*\{[^}]*action:\s*["']import["']/g,
  (m) => m.replace(
    'headers: { "Content-Type": "application/json" }',
    "headers: authHeaders()"
  ).replace(
    "headers: { 'Content-Type': 'application/json' }",
    "headers: authHeaders()"
  )
);

// Explicit known blocks
text = patch(
  text,
  `      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
  action: "import",
  templateId: importTemplateId ? Number(importTemplateId) : null,
}),
      });`,
  `      const res = await fetch("/api/queue", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
  action: "import",
  templateId: importTemplateId ? Number(importTemplateId) : null,
}),
      });`,
  "import live sheet authHeaders"
);

// Never show fake Check .env
text = text.split('Live Google Sheet failed. Check .env').join(
  "Live Google Sheet failed — dekh error message / login dobara"
);

text = patch(
  text,
  `showError(data.error || "Live Google Sheet failed — dekh error message / login dobara");`,
  `showError(
          data.error ||
            (Array.isArray(data.errors) && data.errors.length
              ? data.errors.slice(0, 3).join(" | ")
              : data.message || "Live Google Sheet failed")
        );`,
  "import real error"
);

for (const action of ["process_next", "process_batch", "reset_all", "clear_all"]) {
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "${action}" }),`,
    `headers: authHeaders(),
        body: JSON.stringify({ action: "${action}" }),`,
    action + " auth"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "${action}" }),`,
    `headers: authHeaders(),
            body: JSON.stringify({ action: "${action}" }),`,
    action + " auth 12"
  );
}

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
  "gmail save auth"
);

text = patch(
  text,
  `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE" });`,
  `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE", headers: authHeaders() });`,
  "gmail delete auth"
);

text = patch(
  text,
  `const cRes = await fetch("/api/campaign");`,
  `const cRes = await fetch("/api/campaign", { headers: authHeaders() });`,
  "campaign auth"
);

text = text.replace(
  /headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}\s*,\s*\n\s*headers:\s*authHeaders\(\)/g,
  "headers: authHeaders()"
);

if (text.includes("Check .env")) {
  console.warn("WARN: Check .env still in page — stripped");
  text = text.split("Check .env").join("see error details");
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log("Wrote", OUT, text.length, "bytes");
