#!/usr/bin/env node
/**
 * Rebuild page.tsx:
 * - authHeaders on Run Panel + SMTP + Import
 * - normalize snake_case → camelCase for queue + SMTP display
 * - fix sentThisminute typo
 * - Live Tracking Pixel Opens: full date + time
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "src", "app", "page.tsx");
const SOURCE =
  "https://cdn.jsdelivr.net/gh/jamesrock78691-cube/email-automation-@a92fad723695c11bb1909753ad026eb75e1c76fd/src/app/page.tsx";

function patch(text, oldStr, newStr, label) {
  if (!text.includes(oldStr)) {
    console.log("Skip:", label);
    return text;
  }
  const n = text.split(oldStr).length - 1;
  console.log(`Patched (${n}x):`, label);
  return text.split(oldStr).join(newStr);
}

let text = await (await fetch(SOURCE, { redirect: "follow" })).text();
if (!text.includes("EmailAutomationDashboard")) {
  throw new Error("invalid page source");
}

// ---- Auth on all queue actions (incl auto-run) ----
for (const action of ["process_next", "process_batch", "reset_all", "clear_all"]) {
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },\n            body: JSON.stringify({ action: "${action}" }),`,
    `headers: authHeaders(),\n            body: JSON.stringify({ action: "${action}" }),`,
    action + " auth12"
  );
  text = patch(
    text,
    `headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ action: "${action}" }),`,
    `headers: authHeaders(),\n        body: JSON.stringify({ action: "${action}" }),`,
    action + " auth8"
  );
}

text = text.replace(
  /fetch\(\s*["']\/api\/queue["']\s*,\s*\{\s*method:\s*["']POST["']\s*,\s*headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}/g,
  'fetch("/api/queue", {\n        method: "POST",\n        headers: authHeaders()'
);

text = patch(
  text,
  `      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(gmailForm),
      });`,
  `      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(gmailForm),
      });`,
  "gmail save"
);
text = patch(
  text,
  `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE" });`,
  `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE", headers: authHeaders() });`,
  "gmail delete"
);
text = text.replace(
  /fetch\(\s*["']\/api\/gmail\/test["']\s*,\s*\{\s*method:\s*["']POST["']\s*,\s*headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}/g,
  'fetch("/api/gmail/test", {\n      method: "POST",\n      headers: authHeaders()'
);
text = text.replace(
  /fetch\(\s*["']\/api\/gmail\/verify["']\s*,\s*\{\s*method:\s*["']POST["']\s*,\s*headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}/g,
  'fetch("/api/gmail/verify", {\n      method: "POST",\n      headers: authHeaders()'
);

// ---- Normalize data on dashboard load ----
text = patch(
  text,
  `setGmailAccounts(data.accounts || []);`,
  `setGmailAccounts((data.accounts || []).map((a: any) => ({
          ...a,
          smtpUsername: a.smtpUsername ?? a.smtp_username ?? "",
          fromEmail: a.fromEmail ?? a.from_email ?? a.email ?? "",
          senderName: a.senderName ?? a.sender_name ?? "",
          replyToEmail: a.replyToEmail ?? a.reply_to_email ?? "",
          appPassword: a.appPassword ?? a.app_password ?? "",
          smtpHost: a.smtpHost ?? a.smtp_host ?? "",
          smtpPort: Number(a.smtpPort ?? a.smtp_port ?? 465),
          dailyLimit: Number(a.dailyLimit ?? a.daily_limit ?? 500),
          minuteLimit: Number(a.minuteLimit ?? a.minute_limit ?? 50),
          sentToday: Number(a.sentToday ?? a.sent_today ?? 0),
          sentThisMinute: Number(a.sentThisMinute ?? a.sentThisminute ?? a.sent_this_minute ?? 0),
          priority: Number(a.priority ?? 1),
          lastUsedAt: a.lastUsedAt ?? a.last_used_at ?? null,
          cooldownUntil: a.cooldownUntil ?? a.cooldown_until ?? null,
          errorCount: Number(a.errorCount ?? a.error_count ?? 0),
        })));`,
  "normalize accounts"
);

text = patch(
  text,
  `setQueueItems(data.recentQueue || []);`,
  `setQueueItems((data.recentQueue || []).map((q: any) => ({
          ...q,
          referenceNo: q.referenceNo ?? q.reference_no ?? "",
          serialNo: q.serialNo ?? q.serial_no ?? "",
          markName: q.markName ?? q.mark_name ?? "",
          filingDate: q.filingDate ?? q.filing_date ?? "",
          trackingId: q.trackingId ?? q.tracking_id ?? "",
          gmailUsedEmail: q.gmailUsedEmail ?? q.gmail_used_email ?? null,
          gmailUsedId: q.gmailUsedId ?? q.gmail_used_id ?? null,
          openCount: Number(q.openCount ?? q.open_count ?? 0),
          sentAt: q.sentAt ?? q.sent_at ?? null,
          errorMessage: q.errorMessage ?? q.error_message ?? null,
        })));`,
  "normalize queue"
);

// Normalize recent opens + keep openedAt
text = patch(
  text,
  `setRecentOpens(data.recentOpens || []);`,
  `setRecentOpens((data.recentOpens || []).map((op: any) => ({
          ...op,
          openedAt: op.openedAt ?? op.opened_at ?? null,
          referenceNo: op.referenceNo ?? op.reference_no ?? "",
          markName: op.markName ?? op.mark_name ?? "",
          serialNo: op.serialNo ?? op.serial_no ?? "",
          email: op.email || "",
          ipAddress: op.ipAddress ?? op.ip_address ?? "",
          trackingId: op.trackingId ?? op.tracking_id ?? "",
          gmailUsedEmail: op.gmailUsedEmail ?? op.gmail_used_email ?? null,
        })));`,
  "normalize recent opens"
);

// ---- Live Tracking Pixel Opens: full date + time ----
text = patch(
  text,
  `{new Date(op.openedAt).toLocaleTimeString()}`,
  `{op.openedAt
                                ? new Date(op.openedAt).toLocaleString(undefined, {
                                    year: "numeric",
                                    month: "short",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })
                                : "—"}`,
  "opens date+time"
);

// ---- Display fallbacks + typo fix ----
text = patch(text, "acc.sentThisminute", "(acc.sentThisMinute ?? acc.sentThisminute ?? acc.sent_this_minute ?? 0)", "sentThisMinute typo");
text = patch(text, "{item.referenceNo}", '{item.referenceNo || item.reference_no || "—"}', "ref display");
text = patch(text, "{item.markName}", '{item.markName || item.mark_name || "—"}', "mark display");
text = patch(text, "{item.filingDate}", '{item.filingDate || item.filing_date || "—"}', "filing display");
text = patch(text, "Serial: #{item.serialNo}", 'Serial: #{item.serialNo || item.serial_no || "—"}', "serial display");
text = patch(text, "{item.gmailUsedEmail ? (", "{(item.gmailUsedEmail || item.gmail_used_email) ? (", "gmail cond");
text = patch(text, "{item.gmailUsedEmail}", "{item.gmailUsedEmail || item.gmail_used_email}", "gmail display");
text = patch(text, "{acc.smtpHost}:{acc.smtpPort}", '{acc.smtpHost || acc.smtp_host || "—"}:{acc.smtpPort || acc.smtp_port || "—"}', "host port");
text = patch(text, "Daily: {acc.dailyLimit} / M {acc.minuteLimit}", "Daily: {acc.dailyLimit ?? acc.daily_limit ?? 0} / M {acc.minuteLimit ?? acc.minute_limit ?? 0}", "limits");
text = patch(text, "{acc.sentToday}", "{acc.sentToday ?? acc.sent_today ?? 0}", "sentToday");
text = patch(text, "{acc.fromEmail || acc.email}", "{acc.fromEmail || acc.from_email || acc.email}", "fromEmail");
text = patch(text, "Level {acc.priority}", "Level {acc.priority ?? 1}", "priority");

text = text.split("Live Google Sheet failed. Check .env").join("Live Google Sheet failed");
text = text.split("Check .env").join("see error details");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log("Wrote", OUT, text.length, "bytes");
