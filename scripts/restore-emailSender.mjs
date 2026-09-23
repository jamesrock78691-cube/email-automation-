#!/usr/bin/env node
/**
 * Restores emailSender.ts + workspace sheet updates +
 * Amazon: only mark_name + name | Main: full variable set.
 * Always typed as Record<string, string> to satisfy compileTemplate.
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

  // Build variables as Record<string, string> — no ternary union (TS error fix)
  const NEW_VARS = `  // Amazon: only mark_name + name. Main: full set. Typed as Record<string, string>.
  const isAmazon =
    String(ws || "").toLowerCase() === AMAZON_WORKSPACE ||
    String(ws || "").toLowerCase() === "amazon";
  const variables: Record<string, string> = isAmazon
    ? {
        mark_name: item.markName || "",
        name: item.referenceNo || "",
        tracking_pixel: trackingPixelHtml,
      }
    : {
        reference_no: item.referenceNo || "",
        serial_no: item.serialNo || "",
        mark_name: item.markName || "",
        filing_date: item.filingDate || "",
        owner_name: (item.markName || "") + " Legal Owner",
        client_name: (item.markName || "") + " Client",
        email: item.email || "",
        today: todayStr,
        tracking_pixel: trackingPixelHtml,
      };`;

  const OLD_VARS = `  const variables = {
    reference_no: item.referenceNo || "",
    serial_no: item.serialNo || "",
    mark_name: item.markName || "",
    filing_date: item.filingDate || "",
    owner_name: (item.markName || "") + " Legal Owner",
    client_name: (item.markName || "") + " Client",
    email: item.email,
    today: todayStr,
    tracking_pixel: trackingPixelHtml,
  };`;

  if (text.includes(OLD_VARS)) {
    text = text.replace(OLD_VARS, NEW_VARS);
    console.log("Patched: amazon/main variables (Record<string, string>)");
  } else if (
    text.includes("const variables: Record<string, string>") ||
    text.includes("variables: Record<string, string>")
  ) {
    console.log("Typed variables already present");
  } else {
    // Replace any previous variables block (including broken ternary)
    text = text.replace(
      /(?:\/\/ Amazon[\s\S]*?\n)?\s*(?:const isAmazon[\s\S]*?\n)?\s*const variables(?:: Record<string, string>)?\s*=\s*[\s\S]*?tracking_pixel:\s*trackingPixelHtml,\s*\};/,
      NEW_VARS
    );
    console.log("Patched variables via regex fallback");
  }

  // Extra safety: if still untyped ternary causing issues, force annotation
  if (
    text.includes("const variables =") &&
    !text.includes("const variables: Record<string, string>")
  ) {
    text = text.replace(
      "const variables =",
      "const variables: Record<string, string> ="
    );
    console.log("Forced Record annotation on variables");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("Wrote", OUT, text.length, "bytes");
}

main().catch((e) => {
  console.error("restore-emailSender failed:", e?.message || e);
  if (!fs.existsSync(OUT) || fs.readFileSync(OUT, "utf8").length < 500) {
    process.exit(1);
  }
});
