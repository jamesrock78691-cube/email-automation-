#!/usr/bin/env node
/**
 * Restores src/app/page.tsx from last known-good commit (CDN),
 * then injects contentBase64 storage for template attachments.
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@a92fad723695c11bb1909753ad026eb75e1c76fd/src/app/page.tsx";
const OUT = path.join(__dirname, "..", "src", "app", "page.tsx");

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchText(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          reject(new Error("HTTP " + res.statusCode + " for " + url));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });
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

(async () => {
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
    console.error("rebuild-page failed:", err.message);
    if (!fs.existsSync(OUT)) {
      process.exit(1);
    }
  }
})();
