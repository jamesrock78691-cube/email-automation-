#!/usr/bin/env node
/**
 * Bulletproof sheet Sent status + open tracking fixes.
 * Runs after restore-emailSender / restore-googleSheets / patch-sandeer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const senderPath = path.join(root, "src", "app", "services", "emailSender.ts");
const sheetsPath = path.join(root, "src", "app", "services", "googleSheets.ts");
const trackPath = path.join(
  root,
  "src",
  "app",
  "api",
  "track",
  "[trackingId]",
  "route.ts"
);

const SENT_BLOCK = `    // Sheet Status → Sent (tracking ID first, then email+Imported, never match empty serial)
    try {
      const rows = await readRows(ws);
      const emailKey = String(item.email || "").trim().toLowerCase();
      const serialKey = String(item.serialNo || "").trim();
      const refKey = String(item.referenceNo || "").trim();
      const trackKey = String(trackingId || item.trackingId || "").trim();

      const score = (r: any) => {
        let s = 0;
        const rt = String(r.trackingId || "").trim();
        if (trackKey && rt && rt.toLowerCase() === trackKey.toLowerCase()) s += 100;
        const re = String(r.email || "").trim().toLowerCase();
        if (emailKey && re && re === emailKey) s += 40;
        const rs = String(r.serialNo || "").trim();
        if (serialKey && rs && rs === serialKey) s += 30;
        const rr = String(r.referenceNo || "").trim();
        if (refKey && rr && rr === refKey) s += 20;
        const st = String(r.status || "").trim().toLowerCase();
        if (st === "imported" || st === "pending" || st === "") s += 5;
        return s;
      };

      let best: any = null;
      let bestScore = 0;
      for (const r of rows) {
        const sc = score(r);
        if (sc > bestScore) {
          bestScore = sc;
          best = r;
        }
      }
      // Require at least email or tracking or serial match
      if (best && bestScore >= 30) {
        await updateRow(
          best.rowNumber,
          {
            status: "Sent",
            sentAt: new Date().toISOString(),
            gmailUsed: finalUsedAccount.email,
            trackingId: trackKey || best.trackingId || "",
          },
          ws
        );
        console.log(
          "[SHEET SENT] ws=" +
            ws +
            " row=" +
            best.rowNumber +
            " score=" +
            bestScore +
            " email=" +
            emailKey +
            " track=" +
            trackKey
        );
      } else {
        console.error(
          "[SHEET SENT] no match ws=" +
            ws +
            " email=" +
            emailKey +
            " serial=" +
            serialKey +
            " track=" +
            trackKey +
            " rows=" +
            rows.length
        );
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }`;

// ---- emailSender ----
if (fs.existsSync(senderPath)) {
  let t = fs.readFileSync(senderPath, "utf8");
  // Replace any existing sheet-update try block after status sent
  const re =
    /try\s*\{\s*const rows = await readRows\([^)]*\);[\s\S]*?console\.error\(\s*"Google Sheet update failed"\s*,\s*err\s*\);\s*\}/;
  if (re.test(t)) {
    t = t.replace(re, SENT_BLOCK.trim());
    console.log("emailSender: Sent block replaced (regex)");
  } else {
    // insert before return success after queue status sent
    const marker =
      'return {\n      success: true,\n      gmailUsedEmail: finalUsedAccount.email,';
    if (t.includes(marker) && !t.includes("[SHEET SENT]")) {
      t = t.replace(marker, SENT_BLOCK + "\n\n    " + marker);
      console.log("emailSender: Sent block inserted before return");
    } else {
      console.warn("emailSender: could not locate sheet block");
    }
  }
  fs.writeFileSync(senderPath, t);
}

// ---- googleSheets: wider headers + open by tracking (case-insensitive) ----
if (fs.existsSync(sheetsPath)) {
  let t = fs.readFileSync(sheetsPath, "utf8");

  // Expand header aliases for Status / Tracking / Open Count
  t = t.replace(
    'status: headerIndex(headers, "Status", "status"),',
    'status: headerIndex(headers, "Status", "status", "STATUS", "Email Status", "Send Status"),'
  );
  t = t.replace(
    /trackingId:\s*headerIndex\(\s*headers,\s*"Tracking ID",\s*"tracking_id",\s*"Tracking Id"\s*\)/,
    'trackingId: headerIndex(headers, "Tracking ID", "tracking_id", "Tracking Id", "tracking id", "TrackingID", "Track ID")'
  );
  t = t.replace(
    'openCount: headerIndex(headers, "Open Count", "open_count"),',
    'openCount: headerIndex(headers, "Open Count", "open_count", "Opens", "opens", "Open", "Unique Opens", "OpenCount"),'
  );
  t = t.replace(
    'openedAt: headerIndex(headers, "Opened At", "opened_at"),',
    'openedAt: headerIndex(headers, "Opened At", "opened_at", "Open At", "Last Opened", "Last Opened At"),'
  );
  t = t.replace(
    'sentAt: headerIndex(headers, "Sent At", "sent_at"),',
    'sentAt: headerIndex(headers, "Sent At", "sent_at", "Sent", "Date Sent", "Sent Date"),'
  );
  t = t.replace(
    'gmailUsed: headerIndex(headers, "Gmail Used", "gmail_used"),',
    'gmailUsed: headerIndex(headers, "Gmail Used", "gmail_used", "SMTP Used", "From", "Sender"),'
  );

  // Log when no status column
  if (!t.includes("[SHEETS] missing status column")) {
    t = t.replace(
      "const used = Object.values(cols).filter((c) => c >= 0);\n  if (!used.length) return;",
      `const used = Object.values(cols).filter((c) => c >= 0);
  if (!used.length) {
    console.error("[SHEETS] no writable columns. headers=", headers.join(" | "));
    return;
  }
  if (cols.status < 0) {
    console.error("[SHEETS] missing status column. headers=", headers.join(" | "));
  }`
    );
  }

  // Rewrite recordOpenOnAutoSheet completely
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
    ? [String(preferredWs).toLowerCase(), ...allWs].filter(
        (w, i, a) => w && a.indexOf(w) === i
      )
    : allWs;

  const id = String(trackingId || "").trim();
  if (!id) return { success: false, error: "missing tracking id" };
  const openedAt = openedAtIso || new Date().toISOString();

  for (const ws of tryWs) {
    try {
      const cfg = resolveSheetConfig(ws);
      if (!cfg.id) continue;
      // refresh so we see latest Tracking ID after Sent write
      await getAutoSheet(ws, { refresh: true });
      const rows = await readRows(ws);
      const hit = rows.find(
        (r) =>
          String(r.trackingId || "").trim().toLowerCase() === id.toLowerCase()
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
        "[OPEN SHEET] ws=" +
          ws +
          " row=" +
          hit.rowNumber +
          " opens=" +
          nextCount +
          " id=" +
          id
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
      console.error(
        "recordOpenOnAutoSheet ws=" + ws + ":",
        err?.message || err
      );
    }
  }
  return { success: false, error: "tracking id not found on auto sheet" };
}
`;
    t = t.slice(0, start) + NEW_OPEN + t.slice(end);
    console.log("recordOpenOnAutoSheet rewritten");
  }

  fs.writeFileSync(sheetsPath, t);
  console.log("googleSheets patched");
}

// ---- track route: case-insensitive tracking match + atomic open + after() ----
if (fs.existsSync(trackPath)) {
  let t = fs.readFileSync(trackPath, "utf8");

  if (!t.includes('after } from "next/server"') && !t.includes("after } from 'next/server'")) {
    t = t.replace(
      'import { NextRequest, NextResponse } from "next/server";',
      'import { NextRequest, NextResponse, after } from "next/server";'
    );
  }

  // Case-insensitive queue lookup
  if (!t.includes("lower(tracking_id)")) {
    t = t.replace(
      `const matchedQueue = await db
      .select()
      .from(queue)
      .where(eq(queue.trackingId, trackingId))
      .limit(1);`,
      `let matchedQueue = await db
      .select()
      .from(queue)
      .where(eq(queue.trackingId, trackingId))
      .limit(1);
    if (!matchedQueue.length) {
      try {
        const loose = await db.execute(
          sql\`SELECT * FROM queue WHERE lower(trim(tracking_id)) = lower(trim(\${trackingId})) LIMIT 1\`
        );
        const rows = (loose as any)?.rows || (Array.isArray(loose) ? loose : []);
        if (rows.length) matchedQueue = rows as any;
      } catch (e) {
        console.error("loose tracking lookup failed:", e);
      }
    }`
    );
    console.log("track: case-insensitive lookup");
  }

  // Atomic open_count
  if (!t.includes("coalesce(open_count, 0) + 1")) {
    t = t.replace(
      `try {
        await db
          .update(queue)
          .set({
            openCount: (qItem.openCount || 0) + 1,
            lastOpenedAt: openedAt,
          })
          .where(eq(queue.id, qItem.id));
      } catch (e) {
        console.error("queue openCount update failed:", e);
      }`,
      `try {
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
              openCount: (Number(qItem.openCount) || 0) + 1,
              lastOpenedAt: openedAt,
            })
            .where(eq(queue.id, qItem.id));
        } catch (e2) {
          console.error("queue openCount fallback failed:", e2);
        }
      }`
    );
    console.log("track: atomic open_count");
  }

  // after() for sheet updates (queue branch)
  if (!t.includes("after(async () =>") && t.includes("recordOpenOnAutoSheet")) {
    t = t.replace(
      `// Update BOTH auto sheet and manual log sheet
      await Promise.all([
        recordOpenOnAutoSheet(trackingId, openedAtIso, ws).catch((err) =>
          console.error("auto sheet open update failed:", err)
        ),
        recordOpenOnManualSheet(trackingId, openedAtIso).catch((err) =>
          console.error("manual sheet open update failed:", err)
        ),
      ]);`,
      `after(async () => {
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
      });`
    );
    console.log("track: after() sheet updates");
  }

  fs.writeFileSync(trackPath, t);
  console.log("track route patched");
}

console.log("patch-sheet-sent-open: done");
