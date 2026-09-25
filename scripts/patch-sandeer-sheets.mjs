#!/usr/bin/env node
/**
 * Sandeer sheet + Manual log + robust recordOpenOnAutoSheet.
 * Auto: 1bXYe8aiJsL_6X45N_Bwe_OQG1TTUiVhXU4uhdcbbAsg / Sheet1
 * Manual: 1OPKn3J8oJqTyZ-8OzY5-t-Qx-QV3ySuuCX94qEtnyjU
 */
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
  console.log("skip googleSheets");
  process.exit(0);
}
let t = fs.readFileSync(FILE, "utf8");

const SANDEER_ID = "1bXYe8aiJsL_6X45N_Bwe_OQG1TTUiVhXU4uhdcbbAsg";
const SANDEER_TAB = "Sheet1";
const MANUAL_ID = "1OPKn3J8oJqTyZ-8OzY5-t-Qx-QV3ySuuCX94qEtnyjU";

// --- imports ---
if (!t.includes("SANDEER_WORKSPACE")) {
  t = t.replace(
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, workspaceSql } from "@/lib/workspace";',
    'import { MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE, workspaceSql } from "@/lib/workspace";'
  );
}

// --- constants ---
if (t.includes("SANDEER_SHEET_ID")) {
  t = t.replace(
    /const SANDEER_SHEET_ID[\s\S]*?;/,
    `const SANDEER_SHEET_ID = process.env.GOOGLE_SHEET_ID_SANDEER || "${SANDEER_ID}";`
  );
  t = t.replace(
    /const SANDEER_SHEET_NAME[\s\S]*?;/,
    `const SANDEER_SHEET_NAME = process.env.GOOGLE_SHEET_NAME_SANDEER || "${SANDEER_TAB}";`
  );
} else {
  t = t.replace(
    `const AMAZON_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_AMAZON || "Amazon";

const MANUAL_SHEET_ID`,
    `const AMAZON_SHEET_NAME =
  process.env.GOOGLE_SHEET_NAME_AMAZON || "Amazon";

const SANDEER_SHEET_ID = process.env.GOOGLE_SHEET_ID_SANDEER || "${SANDEER_ID}";
const SANDEER_SHEET_NAME = process.env.GOOGLE_SHEET_NAME_SANDEER || "${SANDEER_TAB}";

const MANUAL_SHEET_ID`
  );
}

t = t.replace(
  /const MANUAL_SHEET_ID\s*=\s*process\.env\.GOOGLE_MANUAL_LOG_SHEET_ID \|\| "[^"]*";/,
  `const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID || "${MANUAL_ID}";`
);
t = t.replace(
  /const MANUAL_SHEET_ID\s*=\s*process\.env\.GOOGLE_MANUAL_LOG_SHEET_ID \|\| "";/,
  `const MANUAL_SHEET_ID = process.env.GOOGLE_MANUAL_LOG_SHEET_ID || "${MANUAL_ID}";`
);

// --- resolveSheetConfig ---
if (!t.includes("SANDEER_WORKSPACE || w === \"sandeer\"") && !t.includes('w === SANDEER_WORKSPACE')) {
  t = t.replace(
    `  if (w === AMAZON_WORKSPACE || w === "amazon") {
    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };
  }
  return { id: SHEET_ID, name: SHEET_NAME };`,
    `  if (w === AMAZON_WORKSPACE || w === "amazon") {
    return { id: AMAZON_SHEET_ID, name: AMAZON_SHEET_NAME };
  }
  if (w === SANDEER_WORKSPACE || w === "sandeer") {
    return { id: SANDEER_SHEET_ID, name: SANDEER_SHEET_NAME };
  }
  return { id: SHEET_ID, name: SHEET_NAME };`
  );
}

// --- Replace recordOpenOnAutoSheet with robust version ---
const ROBUST_OPEN = `/** Increment open count on auto sheet by tracking ID (all workspaces). */
export async function recordOpenOnAutoSheet(
  trackingId: string,
  openedAtIso?: string,
  preferredWs?: string | null
) {
  const id = String(trackingId || "").trim();
  if (!id) return { success: false, error: "no tracking id" };

  const allWs = [MAIN_WORKSPACE, AMAZON_WORKSPACE, SANDEER_WORKSPACE].filter(
    (w, i, a) => a.indexOf(w) === i
  );
  const tryWs = preferredWs
    ? [String(preferredWs).toLowerCase(), ...allWs.filter((w) => w !== String(preferredWs).toLowerCase())]
    : allWs;

  const openedAt = openedAtIso || new Date().toISOString();

  for (const ws of tryWs) {
    try {
      const cfg = resolveSheetConfig(ws);
      if (!cfg.id) {
        console.warn(\`[OPEN SHEET] skip ws=\$\{ws\} — no sheet id\`);
        continue;
      }
      const sheet = await getAutoSheet(ws, { refresh: true });
      await sheet.loadHeaderRow();
      const headers: string[] = (sheet.headerValues || []).map((h: any) =>
        String(h || "")
      );
      console.log(
        \`[OPEN SHEET] ws=\$\{ws\} tab=\$\{cfg.name\} headers=\$\{headers.join("|")}\`
      );

      const rows = await sheet.getRows();
      for (const row of rows as any[]) {
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            try {
              const v = row.get(k);
              if (v !== undefined && v !== null && String(v).trim() !== "") {
                return String(v).trim();
              }
            } catch {}
          }
          // case-insensitive fallback via toObject
          try {
            const obj = row.toObject ? row.toObject() : {};
            const lower: Record<string, string> = {};
            for (const [hk, hv] of Object.entries(obj)) {
              lower[String(hk).trim().toLowerCase()] = String(hv ?? "").trim();
            }
            for (const k of keys) {
              const found = lower[k.trim().toLowerCase()];
              if (found) return found;
            }
          } catch {}
          return "";
        };

        const tid = pick(
          "Tracking ID",
          "tracking_id",
          "Tracking Id",
          "tracking id",
          "TRACKING ID",
          "TrackingID"
        );
        if (!tid || tid.toLowerCase() !== id.toLowerCase()) continue;

        const prev = parseInt(
          pick("Open Count", "open_count", "OpenCount", "opens", "Opens") || "0",
          10
        );
        const next = (Number.isFinite(prev) ? prev : 0) + 1;

        // Set using exact header names present on the sheet
        const setByAliases = (aliases: string[], value: string) => {
          const lowerHeaders = headers.map((h) => h.trim().toLowerCase());
          for (const a of aliases) {
            const idx = lowerHeaders.indexOf(a.toLowerCase());
            if (idx >= 0) {
              row.set(headers[idx], value);
              return true;
            }
          }
          // last resort: first alias as new header key
          try {
            row.set(aliases[0], value);
            return true;
          } catch {
            return false;
          }
        };

        setByAliases(
          ["Open Count", "open_count", "OpenCount", "opens", "Opens"],
          String(next)
        );
        setByAliases(
          ["Opened At", "opened_at", "OpenedAt", "opened at"],
          openedAt
        );
        await row.save();
        console.log(
          \`[OPEN SHEET] UPDATED ws=\$\{ws\} trackingId=\$\{id\} openCount=\$\{next\}\`
        );
        return {
          success: true,
          openCount: next,
          email: pick("Email", "email", "E-mail", "to"),
          referenceNo: pick("reference_no", "Reference No", "Reference", "name"),
          markName: pick("mark_name", "Mark Name", "Mark"),
          workspace: ws,
        };
      }
      console.warn(
        \`[OPEN SHEET] trackingId not found on ws=\$\{ws\} (rows=\$\{rows.length\}) id=\$\{id\}\`
      );
    } catch (err: any) {
      console.error(\`recordOpenOnAutoSheet ws=\$\{ws\}:\`, err?.message || err);
    }
  }
  return { success: false, error: "tracking id not found on any auto sheet" };
}`;

// Escape for regex - replace function body from export async function recordOpenOnAutoSheet through next export
const openRe =
  /\/\*\* Increment open count on auto sheet[\s\S]*?export async function recordOpenOnAutoSheet\([\s\S]*?\n\}\n\nexport async function recordOpenOnManualSheet/;
if (openRe.test(t)) {
  t = t.replace(
    openRe,
    ROBUST_OPEN + "\n\nexport async function recordOpenOnManualSheet"
  );
  console.log("replaced recordOpenOnAutoSheet");
} else if (t.includes("export async function recordOpenOnAutoSheet")) {
  // simpler boundary
  const start = t.indexOf("export async function recordOpenOnAutoSheet");
  const end = t.indexOf("export async function recordOpenOnManualSheet");
  if (start >= 0 && end > start) {
    t = t.slice(0, start) + ROBUST_OPEN + "\n\n" + t.slice(end);
    console.log("replaced recordOpenOnAutoSheet (index)");
  } else {
    console.warn("could not locate recordOpenOnAutoSheet boundaries");
  }
} else {
  console.warn("recordOpenOnAutoSheet not found");
}

fs.writeFileSync(FILE, t);
console.log(
  "patch-sandeer-sheets done",
  "sandeer=",
  t.includes(SANDEER_ID),
  "manual=",
  t.includes(MANUAL_ID),
  "robustOpen=",
  t.includes("[OPEN SHEET] UPDATED")
);
