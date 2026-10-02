#!/usr/bin/env node
/**
 * Restore track route + atomic open_count increment (fixes unique opens stuck/wrong).
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

  const old = `      try {
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

  // Fallback uses typed openCount only (TS rejects open_count on drizzle row)
  const neu = `      try {
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

  if (text.includes(old)) {
    text = text.replace(old, neu);
    console.log("restore-track: atomic open_count applied");
  } else if (text.includes("coalesce(open_count")) {
    // Fix any previous bad open_count access that broke tsc
    text = text.replace(
      /openCount:\s*\(qItem\.openCount\s*\|\|\s*qItem\.open_count\s*\|\|\s*0\)\s*\+\s*1/g,
      "openCount: (qItem.openCount || 0) + 1"
    );
    console.log("restore-track: atomic already present; cleaned open_count TS access");
  } else {
    console.warn("restore-track: openCount block pattern not found — writing source as-is");
  }

  text = text.replace(
    `      // Update BOTH auto sheet and manual log sheet
      await Promise.all([
        recordOpenOnAutoSheet(trackingId, openedAtIso, ws).catch((err) =>
          console.error("auto sheet open update failed:", err)
        ),
        recordOpenOnManualSheet(trackingId, openedAtIso).catch((err) =>
          console.error("manual sheet open update failed:", err)
        ),
      ]);`,
    `      // Sheet updates in background — large main sheets must not delay pixel
      void Promise.all([
        recordOpenOnAutoSheet(trackingId, openedAtIso, ws).catch((err) =>
          console.error("auto sheet open update failed:", err)
        ),
        recordOpenOnManualSheet(trackingId, openedAtIso).catch((err) =>
          console.error("manual sheet open update failed:", err)
        ),
      ]);`
  );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("restore-track: wrote", text.length, "bytes");
}

main().catch((e) => {
  console.error("restore-track FAILED:", e?.message || e);
  process.exit(1);
});
