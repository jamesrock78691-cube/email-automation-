#!/usr/bin/env node
/**
 * Rebuild page.tsx with full auth on Run Panel + SMTP + Import,
 * and safe field fallbacks for serial / gmail used / sentToday.
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
    console.log("Skip (not found):", label);
    return text;
  }
  const count = text.split(oldStr).length - 1;
  text = text.split(oldStr).join(newStr);
  console.log(`Patched (${count}x):`, label);
  return text;
}

let text = await (await fetch(SOURCE, { redirect: "follow" })).text();
if (!text.includes("EmailAutomationDashboard")) {
  throw new Error("Downloaded page looks invalid");
}

// ---- 1) ALL queue control actions need auth (auto-run + buttons) ----
for (const action of ["process_next", "process_batch", "reset_all", "clear_all"]) {
  // any indentation
  text = text.replaceAll(
    `headers: { "Content-Type": "application/json" },\n            body: JSON.stringify({ action: "${action}" }),`,
    `headers: authHeaders(),\n            body: JSON.stringify({ action: "${action}" }),`
  );
  text = text.replaceAll(
    `headers: { "Content-Type": "application/json" },\n        body: JSON.stringify({ action: "${action}" }),`,
    `headers: authHeaders(),\n        body: JSON.stringify({ action: "${action}" }),`
  );
  text = text.replaceAll(
    `headers: { "Content-Type": "application/json" },\n      body: JSON.stringify({ action: "${action}" }),`,
    `headers: authHeaders(),\n      body: JSON.stringify({ action: "${action}" }),`
  );
}

// ---- 2) Import (live sheet) ----
text = patch(
  text,
  `      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
  action: "import",
  templateId: importTemplateId ? Number(importTemplateId) : null,
}),
      });`,
  `      const res = await fetch("/api/queue", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
  action: "import",
  templateId: importTemplateId ? Number(importTemplateId) : null,
}),
      });`,
  "import auth"
);

// Generic: any remaining /api/queue POST with only Content-Type → authHeaders
text = text.replace(
  /fetch\(\s*["']\/api\/queue["']\s*,\s*\{\s*method:\s*["']POST["']\s*,\s*headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}/g,
  'fetch("/api/queue", {\n        method: "POST",\n        headers: authHeaders()'
);

// ---- 3) Gmail / SMTP save, test, verify, delete ----
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
  "gmail save auth"
);

text = patch(
  text,
  `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE" });`,
  `const res = await fetch(\`/api/gmail?id=\${id}\`, { method: "DELETE", headers: authHeaders() });`,
  "gmail delete auth"
);

// test connection
text = text.replace(
  /fetch\(\s*["']\/api\/gmail\/test["']\s*,\s*\{\s*method:\s*["']POST["']\s*,\s*headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}/g,
  'fetch("/api/gmail/test", {\n      method: "POST",\n      headers: authHeaders()'
);
text = text.replace(
  /fetch\(\s*["']\/api\/gmail\/verify["']\s*,\s*\{\s*method:\s*["']POST["']\s*,\s*headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}/g,
  'fetch("/api/gmail/verify", {\n      method: "POST",\n      headers: authHeaders()'
);

text = patch(
  text,
  `const cRes = await fetch("/api/campaign");`,
  `const cRes = await fetch("/api/campaign", { headers: authHeaders() });`,
  "campaign auth"
);

// ---- 4) Run panel table: serial + gmail used fallbacks ----
text = patch(
  text,
  `Serial: #{item.serialNo}`,
  `Serial: #{item.serialNo || item.serial_no || "—"}`,
  "serial fallback"
);
text = patch(
  text,
  `{item.gmailUsedEmail ? (`,
  `{(item.gmailUsedEmail || item.gmail_used_email) ? (`,
  "gmail used condition"
);
text = patch(
  text,
  `{item.gmailUsedEmail}`,
  `{item.gmailUsedEmail || item.gmail_used_email}`,
  "gmail used display"
);

// SMTP sent today fallbacks
text = patch(
  text,
  `{acc.sentToday}`,
  `{acc.sentToday ?? acc.sent_today ?? 0}`,
  "smtp sentToday"
);
text = patch(
  text,
  `{acc.sentThisminute}`,
  `{acc.sentThisMinute ?? acc.sentThisminute ?? acc.sent_this_minute ?? 0}`,
  "smtp sentThisMinute"
);
text = patch(
  text,
  `{acc.fromEmail || acc.email}`,
  `{acc.fromEmail || acc.from_email || acc.email}`,
  "smtp fromEmail"
);
text = patch(
  text,
  `{acc.smtpHost}:{acc.smtpPort}`,
  `{acc.smtpHost || acc.smtp_host}:{acc.smtpPort || acc.smtp_port}`,
  "smtp host port"
);
text = patch(
  text,
  `Daily: {acc.dailyLimit} / M {acc.minuteLimit}`,
  `Daily: {acc.dailyLimit ?? acc.daily_limit ?? 0} / M {acc.minuteLimit ?? acc.minute_limit ?? 0}`,
  "smtp limits"
);

// Normalize accounts when loading dashboard
text = patch(
  text,
  `setGmailAccounts(data.accounts || []);`,
  `setGmailAccounts((data.accounts || []).map((a: any) => ({
          ...a,
          smtpUsername: a.smtpUsername ?? a.smtp_username ?? "",
          fromEmail: a.fromEmail ?? a.from_email ?? "",
          senderName: a.senderName ?? a.sender_name ?? "",
          replyToEmail: a.replyToEmail ?? a.reply_to_email ?? "",
          smtpHost: a.smtpHost ?? a.smtp_host ?? "",
          smtpPort: a.smtpPort ?? a.smtp_port ?? 465,
          dailyLimit: a.dailyLimit ?? a.daily_limit ?? 500,
          minuteLimit: a.minuteLimit ?? a.minute_limit ?? 50,
          sentToday: a.sentToday ?? a.sent_today ?? 0,
          sentThisMinute: a.sentThisMinute ?? a.sent_this_minute ?? 0,
          lastUsedAt: a.lastUsedAt ?? a.last_used_at ?? null,
          cooldownUntil: a.cooldownUntil ?? a.cooldown_until ?? null,
          errorCount: a.errorCount ?? a.error_count ?? 0,
        })));`,
  "normalize gmail accounts"
);

text = patch(
  text,
  `setQueueItems(data.recentQueue || []);`,
  `setQueueItems((data.recentQueue || []).map((q: any) => ({
          ...q,
          serialNo: q.serialNo ?? q.serial_no ?? "",
          referenceNo: q.referenceNo ?? q.reference_no ?? "",
          markName: q.markName ?? q.mark_name ?? "",
          trackingId: q.trackingId ?? q.tracking_id ?? "",
          gmailUsedEmail: q.gmailUsedEmail ?? q.gmail_used_email ?? null,
          gmailUsedId: q.gmailUsedId ?? q.gmail_used_id ?? null,
          openCount: q.openCount ?? q.open_count ?? 0,
          sentAt: q.sentAt ?? q.sent_at ?? null,
          errorMessage: q.errorMessage ?? q.error_message ?? null,
        })));`,
  "normalize queue items"
);

// Fake .env message gone
text = text.split("Live Google Sheet failed. Check .env").join(
  "Live Google Sheet failed"
);
text = text.split("Check .env").join("see error details");

// Dedup headers
text = text.replace(
  /headers:\s*\{\s*["']Content-Type["']\s*:\s*["']application\/json["']\s*\}\s*,\s*\n\s*headers:\s*authHeaders\(\)/g,
  "headers: authHeaders()"
);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log("Wrote", OUT, text.length, "bytes");

// Sanity: process_next must use auth
if (
  text.includes('action: "process_next"') &&
  /action:\s*["']process_next["'][\s\S]{0,120}Content-Type/.test(text) &&
  !/action:\s*["']process_next["'][\s\S]{0,200}authHeaders/.test(text)
) {
  console.warn("WARN: process_next may still lack authHeaders");
}
