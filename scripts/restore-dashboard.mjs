#!/usr/bin/env node
/** Restore dashboard route from last good commit + UI field mapping. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "app",
  "api",
  "dashboard",
  "route.ts"
);

const SOURCE =
  "https://raw.githubusercontent.com/jamesrock78691-cube/email-automation-/f0d09ea88c0d2b147c207e0883a1095b3415508e/src/app/api/dashboard/route.ts";

const HELPER = `
function mapQueueRow(r: any) {
  if (!r) return r;
  return {
    ...r,
    campaignId: r.campaignId ?? r.campaign_id ?? null,
    referenceNo: r.referenceNo ?? r.reference_no ?? "",
    serialNo: r.serialNo ?? r.serial_no ?? "",
    markName: r.markName ?? r.mark_name ?? "",
    filingDate: r.filingDate ?? r.filing_date ?? "",
    templateId: r.templateId ?? r.template_id ?? null,
    trackingId: r.trackingId ?? r.tracking_id ?? "",
    maxTries: r.maxTries ?? r.max_tries ?? 3,
    errorMessage: r.errorMessage ?? r.error_message ?? null,
    gmailUsedId: r.gmailUsedId ?? r.gmail_used_id ?? null,
    gmailUsedEmail: r.gmailUsedEmail ?? r.gmail_used_email ?? null,
    sentAt: r.sentAt ?? r.sent_at ?? null,
    openCount: r.openCount ?? r.open_count ?? 0,
    lastOpenedAt: r.lastOpenedAt ?? r.last_opened_at ?? null,
    createdAt: r.createdAt ?? r.created_at ?? null,
    retryAfter: r.retryAfter ?? r.retry_after ?? null,
    lastErrorType: r.lastErrorType ?? r.last_error_type ?? null,
  };
}

function mapAccountRow(r: any) {
  if (!r) return r;
  return {
    ...r,
    smtpUsername: r.smtpUsername ?? r.smtp_username ?? null,
    fromEmail: r.fromEmail ?? r.from_email ?? null,
    senderName: r.senderName ?? r.sender_name ?? null,
    replyToEmail: r.replyToEmail ?? r.reply_to_email ?? null,
    appPassword: r.appPassword ?? r.app_password ?? "",
    smtpHost: r.smtpHost ?? r.smtp_host ?? "",
    smtpPort: r.smtpPort ?? r.smtp_port ?? 465,
    dailyLimit: r.dailyLimit ?? r.daily_limit ?? 500,
    minuteLimit: r.minuteLimit ?? r.minute_limit ?? 50,
    sentToday: r.sentToday ?? r.sent_today ?? 0,
    sentThisMinute: r.sentThisMinute ?? r.sent_this_minute ?? 0,
    lastUsedAt: r.lastUsedAt ?? r.last_used_at ?? null,
    cooldownUntil: r.cooldownUntil ?? r.cooldown_until ?? null,
    errorCount: r.errorCount ?? r.error_count ?? 0,
    createdAt: r.createdAt ?? r.created_at ?? null,
  };
}

`;

async function main() {
  const res = await fetch(SOURCE, { redirect: "follow" });
  if (!res.ok) throw new Error("HTTP " + res.status);
  let text = await res.text();
  if (!text.includes("export async function GET")) throw new Error("invalid dashboard source");

  if (!text.includes("function mapQueueRow")) {
    text = text.replace(
      "async function countQueue(ws: string, status?: string): Promise<number> {",
      HELPER + "async function countQueue(ws: string, status?: string): Promise<number> {"
    );
  }

  text = text.replace(
    `        const rq = await pool.query(
          \`SELECT * FROM queue WHERE workspace = $1 ORDER BY id DESC LIMIT 50\`,
          [ws]
        );
        recentQueueLogs = rq.rows;`,
    `        const rq = await pool.query(
          \`(
             SELECT * FROM queue
             WHERE workspace = $1 AND status IN ('sent', 'sending', 'failed')
             ORDER BY COALESCE(sent_at, created_at) DESC NULLS LAST, id DESC
             LIMIT 40
           )
           UNION ALL
           (
             SELECT * FROM queue
             WHERE workspace = $1 AND status = 'pending'
             ORDER BY id DESC
             LIMIT 30
           )\`,
          [ws]
        );
        recentQueueLogs = rq.rows;`
  );

  text = text.replace(
    `      accounts: accountsList,
      recentQueue: recentQueueLogs,
      recentOpens,`,
    `      accounts: (accountsList || []).map(mapAccountRow),
      recentQueue: (recentQueueLogs || []).map(mapQueueRow),
      recentOpens,`
  );

  if (!text.includes("mapQueueRow") || !text.includes("gmailUsedEmail")) {
    throw new Error("dashboard patch failed");
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log("restore-dashboard: wrote", text.length, "bytes");
}

main().catch((e) => {
  console.error("restore-dashboard FAILED:", e?.message || e);
  process.exit(1);
});
