#!/usr/bin/env node
/**
 * Restore track route:
 * - atomic open_count increment
 * - next/server `after()` so sheet Open Count still updates on Vercel serverless
 * - no TS-breaking open_count property access
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "api",
  "track",
  "[trackingId]",
  "route.ts"
);

const SOURCE =
  "https://raw.githubusercontent.com/jamesrock78691-cube/email-automation-/f0d09ea88c0d2b147c207e0883a1095b3415508e/src/app/api/track/%5BtrackingId%5D/route.ts";

async function main() {
  const res = await fetch(SOURCE, { redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  let text = await res.text();
  if (!text.includes("export async function GET")) throw new Error("invalid track source");

  // Import after from next/server
  if (!text.includes('after } from "next/server"') && !text.includes("after } from 'next/server'")) {
    text = text.replace(
      'import { NextRequest, NextResponse } from "next/server";',
      'import { NextRequest, NextResponse, after } from "next/server";'
    );
  }

  const oldInc = `      try {
        await db
          .update(queue)
          .set({
            openCount: (qItem.openCount || 0) + 1,
            lastOpenedAt: openedAt,
          })
          .where(eq(queue.id, qItem.id));
      } catch (e) {
        console.error("queue openCount update failed:", e);
      }`;

  const neuInc = `      try {
        await db.execute(
          sql\`UPDATE queue
              SET open_count = coalesce(open_count, 0) + 1,
                  last_opened_at = \${openedAt}
              WHERE id = \${qItem.id}\`
        );
      } catch (e) {
        console.error("queue openCount update failed:", e);
        try {
          await db
            .update(queue)
            .set({
              openCount: (qItem.openCount || 0) + 1,
              lastOpenedAt: openedAt,
            })
            .where(eq(queue.id, qItem.id));
        } catch (e2) {
          console.error("queue openCount fallback failed:", e2);
        }
      }`;

  if (text.includes(oldInc)) {
    text = text.replace(oldInc, neuInc);
    console.log("restore-track: atomic open_count applied");
  } else if (text.includes("coalesce(open_count")) {
    text = text.replace(
      /openCount:\s*\(qItem\.openCount\s*\|\|\s*qItem\.open_count\s*\|\|\s*0\)\s*\+\s*1/g,
      "openCount: (qItem.openCount || 0) + 1"
    );
    console.log("restore-track: atomic present; cleaned TS");
  } else {
    console.warn("restore-track: openCount pattern not found");
  }

  const oldSheet = `      // Update BOTH auto sheet and manual log sheet
      await Promise.all([
        recordOpenOnAutoSheet(trackingId, openedAtIso, ws).catch((err) =>
          console.error("auto sheet open update failed:", err)
        ),
        recordOpenOnManualSheet(trackingId, openedAtIso).catch((err) =>
          console.error("manual sheet open update failed:", err)
        ),
      ]);`;

  const neuSheet = `      // after(): finish sheet Open Count / Opened At after pixel returns (Vercel serverless-safe)
      after(async () => {
        try {
          await Promise.all([
            recordOpenOnAutoSheet(trackingId, openedAtIso, ws).catch((err) =>
              console.error("auto sheet open update failed:", err)
            ),
            recordOpenOnManualSheet(trackingId, openedAtIso).catch((err) =>
              console.error("manual sheet open update failed:", err)
            ),
          ]);
        } catch (err) {
          console.error("sheet open after() failed:", err);
        }
      });`;

  if (text.includes(oldSheet)) {
    text = text.replace(oldSheet, neuSheet);
    console.log("restore-track: after() sheet updates applied");
  } else if (text.includes("void Promise.all")) {
    text = text.replace(
      /\/\/ Sheet updates in background[\s\S]*?void Promise\.all\(\[[\s\S]*?\]\);/,
      neuSheet
    );
    console.log("restore-track: replaced void Promise with after()");
  } else if (text.includes("after(async () =>")) {
    console.log("restore-track: after() already present");
  } else {
    console.warn("restore-track: sheet update block not matched");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("restore-track: wrote", text.length, "bytes");
}

main().catch((e) => {
  console.error("restore-track FAILED:", e?.message || e);
  process.exit(1);
});
