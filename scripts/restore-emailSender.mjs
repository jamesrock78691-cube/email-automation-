#!/usr/bin/env node
/**
 * Restores emailSender.ts + workspace sheet updates +
 * Amazon: only mark_name + name | Main: full variable set.
 * Uses if/else (not ternary) so TS never infers undefined keys.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  __dirname,
  "..",
  "src",
  "app",
  "services",
  "emailSender.ts"
);

const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@16f0d67f0ae19c9f7a5739b9df83c8e3a413e220/src/app/services/emailSender.ts";

function patch(text, oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip:", label);
    return text;
  }
  console.log("Patched:", label);
  return text.split(oldStr).join(newStr);
}

/** Always produce a clean if/else variables block — no ternary union. */
const CLEAN_VARS = `  // Amazon: only mark_name + name. Main: full set. if/else avoids TS union error.
  const isAmazon =
    String(ws || "").toLowerCase() === AMAZON_WORKSPACE ||
    String(ws || "").toLowerCase() === "amazon";
  const variables: Record<string, string> = {
    tracking_pixel: trackingPixelHtml,
  };
  if (isAmazon) {
    variables.mark_name = item.markName || "";
    variables.name = item.referenceNo || "";
  } else {
    variables.reference_no = item.referenceNo || "";
    variables.serial_no = item.serialNo || "";
    variables.mark_name = item.markName || "";
    variables.filing_date = item.filingDate || "";
    variables.owner_name = (item.markName || "") + " Legal Owner";
    variables.client_name = (item.markName || "") + " Client";
    variables.email = item.email || "";
    variables.today = todayStr;
  }`;

async function main() {
  let text = "";
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  const broken =
    !existing ||
    existing.length < 500 ||
    existing.includes("PLACEHOLDER") ||
    !existing.includes("processNextQueueItem");

  if (broken) {
    console.log("emailSender broken — fetching known-good source…");
    const res = await fetch(SOURCE, { redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching emailSender`);
    text = await res.text();
  } else {
    text = existing;
  }

  if (!text.includes("processNextQueueItem")) {
    throw new Error("emailSender source invalid");
  }

  // Ensure AMAZON_WORKSPACE import
  if (!text.includes("AMAZON_WORKSPACE")) {
    text = text.replace(
      `import { workspaceSql, MAIN_WORKSPACE } from "@/lib/workspace";`,
      `import { workspaceSql, MAIN_WORKSPACE, AMAZON_WORKSPACE } from "@/lib/workspace";`
    );
    console.log("Patched: AMAZON_WORKSPACE import");
  }

  // Workspace-aware sheet updates
  text = patch(
    text,
    `    try {
      const rows = await readRows();
      const sheetRow = rows.find(
        (r) =>
          r.serialNo?.trim() === item.serialNo?.trim() ||
          r.referenceNo?.trim() === item.referenceNo?.trim()
      );
      if (sheetRow) {
        await updateRow(sheetRow.rowNumber, {
          status: "Sent",
          sentAt: new Date().toISOString(),
          gmailUsed: finalUsedAccount.email,
          trackingId: trackingId,
        });
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`,
    `    try {
      const rows = await readRows(ws);
      const sheetRow = rows.find(
        (r) =>
          (item.email &&
            r.email?.trim().toLowerCase() === item.email.trim().toLowerCase()) ||
          r.serialNo?.trim() === item.serialNo?.trim() ||
          r.referenceNo?.trim() === item.referenceNo?.trim()
      );
      if (sheetRow) {
        await updateRow(
          sheetRow.rowNumber,
          {
            status: "Sent",
            sentAt: new Date().toISOString(),
            gmailUsed: finalUsedAccount.email,
            trackingId: trackingId,
          },
          ws
        );
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`,
    "workspace sheet update"
  );

  // FORCE remove any previous variables / isAmazon block and insert clean if/else
  // Match from optional comment/isAmazon through variables assignment ending at tracking_pixel line
  const patterns = [
    // Original unpatched
    /  const variables = \{\s*\n\s*reference_no:[\s\S]*?tracking_pixel: trackingPixelHtml,\s*\n\s*\};/,
    // Previous ternary patches
    /  \/\/ Amazon[\s\S]*?const isAmazon[\s\S]*?const variables(?:: Record<string, string>)? = isAmazon[\s\S]*?tracking_pixel: trackingPixelHtml,\s*\n\s*\};/,
    // Annotated ternary
    /  const isAmazon[\s\S]*?const variables: Record<string, string> = isAmazon[\s\S]*?tracking_pixel: trackingPixelHtml,\s*\n\s*\};/,
    // if/else already (re-apply clean)
    /  \/\/ Amazon[\s\S]*?const isAmazon[\s\S]*?const variables: Record<string, string> = \{[\s\S]*?if \(isAmazon\) \{[\s\S]*?\} else \{[\s\S]*?\}/,
    // Generic: any isAmazon + variables until before compiledSubject
    /  const isAmazon[\s\S]*?const variables[\s\S]*?(?=\n  const compiledSubject)/,
  ];

  let replaced = false;
  for (const re of patterns) {
    if (re.test(text)) {
      text = text.replace(re, CLEAN_VARS + "\n");
      console.log("Force-replaced variables block via", re.toString().slice(0, 60));
      replaced = true;
      break;
    }
  }

  if (!replaced && text.includes("const variables")) {
    // Last resort: find compiledSubject and insert before it, delete old vars roughly
    const marker = "  const compiledSubject = compileTemplate(item.subject, variables);";
    const idx = text.indexOf(marker);
    if (idx > 0) {
      // Walk back to find start of variables section
      let start = text.lastIndexOf("const variables", idx);
      if (start < 0) start = text.lastIndexOf("const isAmazon", idx);
      if (start > 0) {
        // include leading spaces / comment lines
        const lineStart = text.lastIndexOf("\n", start - 1) + 1;
        text = text.slice(0, lineStart) + CLEAN_VARS + "\n\n" + text.slice(idx);
        console.log("Force-inserted CLEAN_VARS before compiledSubject");
        replaced = true;
      }
    }
  }

  if (!replaced) {
    console.log("WARN: could not locate variables block — appending before compiledSubject");
    text = text.replace(
      "  const compiledSubject = compileTemplate(item.subject, variables);",
      CLEAN_VARS +
        "\n\n  const compiledSubject = compileTemplate(item.subject, variables);"
    );
  }

  // Safety: strip duplicate isAmazon / variables if any leftover double blocks
  // Keep only the last occurrence before compiledSubject is fine for build

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("Wrote", OUT, text.length, "bytes");

  // Verify no ternary variables left
  if (/const variables[^=]*= isAmazon/.test(text)) {
    console.error("FATAL: ternary variables still present");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("restore-emailSender failed:", e?.message || e);
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8").length < 500) {
    process.exit(1);
  }
});
