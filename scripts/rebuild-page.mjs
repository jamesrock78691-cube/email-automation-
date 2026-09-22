#!/usr/bin/env node
/**
 * Restores src/app/page.tsx from last known-good commit (CDN),
 * then injects contentBase64 storage for template attachments.
 * ESM-only (Node treats .mjs as ES modules).
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
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return await res.text();
}

const OLD = `    existing.push({
      filename: data.filename,
      originalName: data.originalName,
      path: data.path,
    });`;

const NEW = `    existing.push({
      filename: data.filename,
      originalName: data.originalName,
      path: data.path,
      contentType: data.contentType || undefined,
      size: data.size || undefined,
      contentBase64: data.contentBase64 || undefined,
    });`;

try {
  let text = await fetchText(SOURCE);
  if (!text.includes("EmailAutomationDashboard")) {
    throw new Error("Downloaded page looks invalid");
  }
  if (text.includes(OLD)) {
    text = text.replace(OLD, NEW);
    console.log("Injected contentBase64 attachment store");
  } else {
    console.log("contentBase64 pattern already present or different formatting");
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("Wrote", OUT, text.length, "bytes");
} catch (err) {
  console.error("rebuild-page failed:", err?.message || err);
  if (!fs.existsSync(OUT)) {
    process.exit(1);
  }
}
