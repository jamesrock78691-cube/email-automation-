#!/usr/bin/env node
/** Restore dashboard: camelCase fields, sent in run panel, working recentOpens. */
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

const OPENS_BLOCK = `
    let recentOpens: any[] = [];
    try {
      const ro = await pool.query(
        \`SELECT
           tl.id,
           tl.opened_at,
           tl.ip_address,
           tl.user_agent,
           tl.browser,
           tl.device,
           tl.tracking_id,
           tl.queue_id,
           tl.email AS log_email,
           tl.mark_name AS log_mark,
           tl.reference_no AS log_ref,
           q.reference_no AS q_ref,
           q.serial_no AS q_serial,
           q.mark_name AS q_mark,
           q.email AS q_email,
           q.gmail_used_email AS q_gmail
         FROM tracking_logs tl
         LEFT JOIN queue q
           ON q.tracking_id = tl.tracking_id
           OR (tl.queue_id IS NOT NULL AND q.id = tl.queue_id)
         WHERE COALESCE(NULLIF(TRIM(tl.workspace), ''), q.workspace, 'main') = $1
            OR q.workspace = $1
         ORDER BY tl.opened_at DESC NULLS LAST
         LIMIT 40\`,
        [ws]
      );
      recentOpens = (ro.rows || []).map((op: any) => {
        const isManual = op.queue_id == null && !op.q_email;
        return {
          id: op.id,
          openedAt: op.opened_at,
          ipAddress: op.ip_address,
          userAgent: op.user_agent,
          browser: op.browser,
          device: op.device,
          trackingId: op.tracking_id,
          queueId: op.queue_id,
          source: isManual ? "manual" : "auto",
          referenceNo: op.q_ref || op.log_ref || (isManual ? "MANUAL" : "—"),
          markName: op.q_mark || op.log_mark || (isManual ? "Manual Send" : "—"),
          email: op.q_email || op.log_email || "",
          serialNo: op.q_serial || "",
          gmailUsedEmail: op.q_gmail || null,
          gmailUsedId: null as number | null,
        };
      });
    } catch (e) {
      console.error("recentOpens:", e);
      recentOpens = [];
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

  // Replace broken drizzle recentOpens block with raw SQL
  const opensStart = text.indexOf("    let recentOpens: any[] = [];");
  const opensEnd = text.indexOf("    return NextResponse.json({");
  if (opensStart >= 0 && opensEnd > opensStart) {
    text = text.slice(0, opensStart) + OPENS_BLOCK + "\n" + text.slice(opensEnd);
  }

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
