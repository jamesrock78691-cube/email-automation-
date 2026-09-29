#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "api", "queue", "route.ts");
if (!fs.existsSync(p)) process.exit(0);
let t = fs.readFileSync(p, "utf8");
const old = `    return NextResponse.json({ success: true, list: r.rows, workspace: ws });`;
const neu = `    const list = (r.rows || []).map((row) => ({
      ...row,
      serialNo: row.serial_no ?? row.serialNo ?? "",
      referenceNo: row.reference_no ?? row.referenceNo ?? "",
      markName: row.mark_name ?? row.markName ?? "",
      trackingId: row.tracking_id ?? row.trackingId ?? "",
      gmailUsedEmail: row.gmail_used_email ?? row.gmailUsedEmail ?? null,
      gmailUsedId: row.gmail_used_id ?? row.gmailUsedId ?? null,
      openCount: row.open_count ?? row.openCount ?? 0,
      sentAt: row.sent_at ?? row.sentAt ?? null,
      lastOpenedAt: row.last_opened_at ?? row.lastOpenedAt ?? null,
      errorMessage: row.error_message ?? row.errorMessage ?? null,
    }));
    return NextResponse.json({ success: true, list, workspace: ws });`;
if (t.includes(old) && !t.includes("gmailUsedEmail: row.gmail_used_email")) {
  t = t.replace(old, neu);
  fs.writeFileSync(p, t);
  console.log("patch-queue-camel: applied");
} else {
  console.log("patch-queue-camel: skip");
}
