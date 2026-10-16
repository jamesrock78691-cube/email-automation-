#!/usr/bin/env node
/**
 * After restore-emailSender + restore-googleSheets + patch-sandeer:
 * 1) Stronger Sent status write to sheet (email/serial/ref/tracking match + workspace)
 * 2) recordOpenOnAutoSheet uses updateRow (batch cells) so Open Count sticks
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const senderPath = path.join(root, "src", "app", "services", "emailSender.ts");
const sheetsPath = path.join(root, "src", "app", "services", "googleSheets.ts");

function patchFile(file, pairs, label) {
  if (!fs.existsSync(file)) {
    console.log("skip", label, "— missing");
    return;
  }
  let t = fs.readFileSync(file, "utf8");
  let n = 0;
  for (const [a, b] of pairs) {
    if (t.includes(a)) {
      t = t.split(a).join(b);
      n++;
    }
  }
  fs.writeFileSync(file, t);
  console.log(label, "patches applied:", n);
}

// --- emailSender: replace sheet update block (with or without ws) ---
if (fs.existsSync(senderPath)) {
  let t = fs.readFileSync(senderPath, "utf8");
  const NEW = `    try {
      const rows = await readRows(ws);
      const emailKey = String(item.email || "").trim().toLowerCase();
      const serialKey = String(item.serialNo || "").trim();
      const refKey = String(item.referenceNo || "").trim();
      const trackKey = String(trackingId || "").trim();
      let sheetRow = rows.find((r) => {
        if (trackKey && String(r.trackingId || "").trim() === trackKey) return true;
        if (emailKey && String(r.email || "").trim().toLowerCase() === emailKey) return true;
        if (serialKey && String(r.serialNo || "").trim() === serialKey) return true;
        if (refKey && String(r.referenceNo || "").trim() === refKey) return true;
        return false;
      });
      if (!sheetRow && emailKey) {
        const candidates = rows.filter(
          (r) => String(r.email || "").trim().toLowerCase() === emailKey
        );
        sheetRow =
          candidates.find((r) => {
            const st = String(r.status || "").trim().toLowerCase();
            return !st || st === "pending" || st === "imported";
          }) || candidates[0];
      }
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
        console.log(
          "[SHEET SENT] ws=" +
            ws +
            " row=" +
            sheetRow.rowNumber +
            " email=" +
            emailKey +
            " track=" +
            trackKey
        );
      } else {
        console.error(
          "[SHEET SENT] no matching row ws=" +
            ws +
            " email=" +
            emailKey +
            " serial=" +
            serialKey +
            " ref=" +
            refKey
        );
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`;

  const patterns = [
    /try \{\s*const rows = await readRows\(ws\);[\s\S]*?console\.error\("Google Sheet update failed", err\);\s*\}/,
    /try \{\s*const rows = await readRows\(\);[\s\S]*?console\.error\("Google Sheet update failed", err\);\s*\}/,
  ];
  let ok = false;
  for (const re of patterns) {
    if (re.test(t)) {
      t = t.replace(re, NEW.trim());
      ok = true;
      break;
    }
  }
  if (!ok) console.warn("emailSender sheet block not matched");
  else console.log("emailSender sheet Sent block patched");
  fs.writeFileSync(senderPath, t);
}

// --- googleSheets: rewrite recordOpenOnAutoSheet ---
if (fs.existsSync(sheetsPath)) {
  let t = fs.readFileSync(sheetsPath, "utf8");
  const start = t.indexOf("export async function recordOpenOnAutoSheet(");
  if (start >= 0) {
    const next = t.indexOf("\nexport async function", start + 10);
    const end = next > 0 ? next : t.length;
    const NEW_OPEN = `export async function recordOpenOnAutoSheet(
  trackingId: string,
  openedAtIso?: string,
  preferredWs?: string | null
) {
  const allWs = ["main", "amazon", "sandeer"];
  const tryWs = preferredWs
    ? [String(preferredWs).toLowerCase(), ...allWs].filter((w, i, a) => w && a.indexOf(w) === i)
    : allWs;

  const id = String(trackingId || "").trim();
  if (!id) return { success: false, error: "missing tracking id" };
  const openedAt = openedAtIso || new Date().toISOString();

  for (const ws of tryWs) {
    try {
      const cfg = resolveSheetConfig(ws);
      if (!cfg.id) continue;
      const rows = await readRows(ws);
      const hit = rows.find(
        (r) => String(r.trackingId || "").trim().toLowerCase() === id.toLowerCase()
      );
      if (!hit) {
        console.log("[OPEN SHEET] tracking not found ws=" + ws + " id=" + id);
        continue;
      }
      const prev = parseInt(
        String(hit.openCount || "0").replace(/[^0-9]/g, "") || "0",
        10
      );
      const nextCount = (Number.isFinite(prev) ? prev : 0) + 1;
      await updateRow(
        hit.rowNumber,
        {
          openCount: String(nextCount),
          openedAt,
          trackingId: id,
        },
        ws
      );
      console.log(
        "[OPEN SHEET] ws=" + ws + " row=" + hit.rowNumber + " opens=" + nextCount + " id=" + id
      );
      return {
        success: true,
        openCount: nextCount,
        email: hit.email,
        referenceNo: hit.referenceNo,
        markName: hit.markName,
        workspace: ws,
      };
    } catch (err: any) {
      console.error("recordOpenOnAutoSheet ws=" + ws + ":", err?.message || err);
    }
  }
  return { success: false, error: "tracking id not found on auto sheet" };
}
`;
    t = t.slice(0, start) + NEW_OPEN + t.slice(end);
    fs.writeFileSync(sheetsPath, t);
    console.log("recordOpenOnAutoSheet rewritten");
  } else {
    console.warn("recordOpenOnAutoSheet not found");
  }
}

console.log("patch-sheet-sent-open: done");
