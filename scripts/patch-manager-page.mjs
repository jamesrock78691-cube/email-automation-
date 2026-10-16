#!/usr/bin/env node
/**
 * Manager progress panel + Super Admin Team Progress TAB.
 * Restored after accidental PLACEHOLDER overwrite.
 * Caption no longer says auto+manual.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "page.tsx");
if (!fs.existsSync(FILE)) {
  console.log("patch-manager-page: no page.tsx");
  process.exit(0);
}
let text = fs.readFileSync(FILE, "utf8");

function patch(oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip:", label);
    return false;
  }
  text = text.split(oldStr).join(newStr);
  console.log("Patched:", label);
  return true;
}

// Always strip the unwanted caption wherever it appears
patch(
  "Includes auto + manual sends as one total. Day resets 00:00 PST. Month from the 1st (PST).",
  "Day resets 00:00 PST. Month from the 1st (PST).",
  "manager caption"
);
patch(
  "Total sent (auto + manual combined). Choose who the manager can see. PST day 00:00 · month from 1st.",
  "Total sent. Choose who the manager can see. PST day 00:00 · month from 1st.",
  "team progress subtitle"
);

// Re-fetch full manager injector from known-good if page has no manager UI yet
if (!text.includes("isManagerOnly") || !text.includes("Team Progress")) {
  console.log("Manager UI missing — downloading base injector…");
  const url =
    "https://raw.githubusercontent.com/jamesrock78691-cube/email-automation-/b32b87885c33fa897df85c6bc813a25a7a9dedaf/scripts/patch-manager-page.mjs";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Cannot fetch base patch-manager-page: " + res.status);
  const base = await res.text();
  // Run base by writing temp and importing is hard; instead eval the file body after stripping shebang
  const tmp = path.join(path.dirname(FILE), "..", "..", "scripts", "_tmp_mgr_base.mjs");
  let body = base
    .replace(
      "Includes auto + manual sends as one total. Day resets 00:00 PST. Month from the 1st (PST).",
      "Day resets 00:00 PST. Month from the 1st (PST)."
    )
    .replace(
      "Total sent (auto + manual combined). Choose who the manager can see. PST day 00:00 · month from 1st.",
      "Total sent. Choose who the manager can see. PST day 00:00 · month from 1st."
    );
  fs.writeFileSync(tmp, body);
  console.log("Wrote temp base; re-executing via spawn…");
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [tmp], { stdio: "inherit" });
  try { fs.unlinkSync(tmp); } catch {}
  if (r.status !== 0) process.exit(r.status || 1);
  // re-read after base ran
  text = fs.readFileSync(FILE, "utf8");
  patch(
    "Includes auto + manual sends as one total. Day resets 00:00 PST. Month from the 1st (PST).",
    "Day resets 00:00 PST. Month from the 1st (PST).",
    "manager caption post-base"
  );
}

fs.writeFileSync(FILE, text);
console.log("patch-manager-page: done", text.length);
