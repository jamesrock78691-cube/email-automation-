import nodemailer from "nodemailer";
import fs from "fs";
import { db } from "@/db";
import { gmailAccounts, queue, templates, campaigns } from "@/db/schema";
import { eq, asc, and, or, isNull, lte, sql } from "drizzle-orm";
import { quillToEmailHtml } from "@/lib/quillToEmailHtml";
import { readRows, updateRow } from "@/app/services/googleSheets";

export interface SendResult {
  success: boolean;
  error?: string;
  gmailUsedEmail?: string;
  gmailUsedId?: number;
  processedItemId?: number;
}

export function compileTemplate(
  html: string,
  variables: Record<string, string>
): string {
  let result = html;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "gi");
    result = result.replace(regex, value || "");
  }
  return result;
}

// ===== Error classifier =====
function classifyError(errorMessage: string): {
  type: "auth" | "rate_limit" | "permanent" | "temporary";
  shouldDisableAccount: boolean;
  retryable: boolean;
} {
  const msg = (errorMessage || "").toLowerCase();

  // Auth errors
  if (
    msg.includes("invalid login") ||
    msg.includes("authentication failed") ||
    msg.includes("username and password not accepted") ||
    msg.includes("badcredentials") ||
    msg.includes("535") ||
    msg.includes("534")
  ) {
    return { type: "auth", shouldDisableAccount: true, retryable: false };
  }

  // Rate limit / quota
  if (
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    msg.includes("quota") ||
    msg.includes("daily") ||
    msg.includes("421") ||
    msg.includes("450") ||
    msg.includes("452")
  ) {
    return { type: "rate_limit", shouldDisableAccount: false, retryable: true };
  }

  // Permanent recipient / content errors
  if (
    msg.includes("user unknown") ||
    msg.includes("mailbox not found") ||
    msg.includes("recipient rejected") ||
    msg.includes("address rejected") ||
    msg.includes("550") ||
    msg.includes("551") ||
    msg.includes("553") ||
    msg.includes("554") ||
    msg.includes("invalid address")
  ) {
    return { type: "permanent", shouldDisableAccount: false, retryable: false };
  }

  // Default = temporary
  return { type: "temporary", shouldDisableAccount: false, retryable: true };
}

// ===== Exponential backoff (seconds) =====
function getBackoffSeconds(tries: number): number {
  // try 1 → 30s, try 2 → 120s, try 3 → 300s
  const map: Record<number, number> = {
    1: 30,
    2: 120,
    3: 300,
  };
  return map[tries] || 600;
}

export async function processNextQueueItem(
  baseUrl: string
): Promise<SendResult> {
  const now = new Date();
  const todayLocal = now.toLocaleDateString("en-CA");

  // 1. Get next eligible pending email
  //    - status = pending
  //    - retryAfter is null OR retryAfter <= now
  const pendingItems = await db
    .select()
    .from(queue)
    .where(
      and(
        eq(queue.status, "pending"),
        or(isNull(queue.retryAfter), lte(queue.retryAfter, now))
      )
    )
    .orderBy(asc(queue.tries), asc(queue.id))
    .limit(1);

  if (pendingItems.length === 0) {
    return {
      success: false,
      error: "No pending emails ready for retry.",
    };
  }

  const item = pendingItems[0];

  // 2. Load accounts
  const accounts = await db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.status, "enabled"));

  // 3. Daily + Minute reset
  for (const acc of accounts) {
    const updates: any = {};
    let needsUpdate = false;

    if (acc.lastUsedAt) {
      const lastUsedLocal = new Date(acc.lastUsedAt).toLocaleDateString("en-CA");
      if (lastUsedLocal !== todayLocal) {
        updates.sentToday = 0;
        needsUpdate = true;
      }
    } else {
      updates.sentToday = 0;
      needsUpdate = true;
    }

    if (acc.lastUsedAt) {
      const diffSeconds =
        (now.getTime() - new Date(acc.lastUsedAt).getTime()) / 1000;
      if (diffSeconds >= 60) {
        updates.sentThisMinute = 0;
        needsUpdate = true;
      }
    } else {
      updates.sentThisMinute = 0;
      needsUpdate = true;
    }

    if (needsUpdate) {
      await db
        .update(gmailAccounts)
        .set(updates)
        .where(eq(gmailAccounts.id, acc.id));

      if (updates.sentToday !== undefined) acc.sentToday = updates.sentToday;
      if (updates.sentThisMinute !== undefined)
        acc.sentThisMinute = updates.sentThisMinute;
    }
  }

  // 4. Healthy accounts filter
  const healthyAccounts = accounts.filter((acc) => {
    if (acc.cooldownUntil && acc.cooldownUntil > now) return false;
    if ((acc.sentToday || 0) >= acc.dailyLimit) return false;
    if ((acc.sentThisMinute || 0) >= acc.minuteLimit) return false;
    return true;
  });

  if (healthyAccounts.length === 0) {
    // No account available right now → schedule retry later
    const retryAfter = new Date();
    retryAfter.setMinutes(retryAfter.getMinutes() + 2);

    await db
      .update(queue)
      .set({
        status: "pending",
        retryAfter,
        lastErrorType: "rate_limit",
        errorMessage: "No available Gmail accounts right now. Will retry later.",
      })
      .where(eq(queue.id, item.id));

    return {
      success: false,
      error: "No available Gmail accounts right now.",
      processedItemId: item.id,
    };
  }

  // Health-aware sort: high priority, low errorCount
  healthyAccounts.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (a.errorCount || 0) - (b.errorCount || 0);
  });

  // 5. Prepare email content
  const todayStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const trackingPixelHtml = `<img src="${baseUrl}/api/track/${item.trackingId}" width="1" height="1" style="display:none"/>`;

  const variables = {
    reference_no: item.referenceNo || "",
    serial_no: item.serialNo || "",
    mark_name: item.markName || "",
    filing_date: item.filingDate || "",
    owner_name: (item.markName || "") + " Legal Owner",
    client_name: (item.markName || "") + " Client",
    email: item.email,
    today: todayStr,
    tracking_pixel: trackingPixelHtml,
  };

  const compiledSubject = compileTemplate(item.subject, variables);

  let rawHtml = "";
  let rawText = "";

  // Resolve template: queue.templateId → else campaign.templateId
  let resolvedTemplateId = item.templateId || null;
  if (!resolvedTemplateId && item.campaignId) {
    const camp = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, item.campaignId))
      .limit(1);
    if (camp.length && camp[0].templateId) {
      resolvedTemplateId = camp[0].templateId;
    }
  }

  if (resolvedTemplateId) {
    const template = await db
      .select()
      .from(templates)
      .where(eq(templates.id, resolvedTemplateId))
      .limit(1);

    if (template.length) {
      rawHtml = template[0].bodyHtml;
      rawText = template[0].bodyText || "";
    }
  }

  if (!rawHtml) {
    rawHtml = `
      <div style="font-family:Arial">
        <h2>Trademark Advisory</h2>
        <p>Reference: {{reference_no}}</p>
        <p>Serial: {{serial_no}}</p>
        <p>Mark: {{mark_name}}</p>
        {{tracking_pixel}}
      </div>
    `;
  }

  const finalHtml = quillToEmailHtml(compileTemplate(rawHtml, variables));

  const finalText = rawText.trim()
    ? compileTemplate(rawText, variables)
    : finalHtml
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();

  let attachmentsList: any[] = [];
  try {
    if (resolvedTemplateId) {
      const tmpl = await db
        .select()
        .from(templates)
        .where(eq(templates.id, resolvedTemplateId))
        .limit(1);

      if (tmpl.length && tmpl[0].attachmentsJson) {
        const parsed = JSON.parse(tmpl[0].attachmentsJson);
        if (Array.isArray(parsed)) {
          attachmentsList = parsed
            .filter((att: any) => att.path && fs.existsSync(att.path))
            .map((att: any) => ({
              filename: att.originalName || att.filename,
              path: att.path,
            }));
        }
      }
    }
  } catch (err) {
    console.error("Attachment parse error", err);
  }

  // 6. Mark sending
  await db
    .update(queue)
    .set({
      status: "sending",
      tries: item.tries + 1,
    })
    .where(eq(queue.id, item.id));

  const currentTries = item.tries + 1;

  // 7. Try accounts (failover)
  let transportSuccess = false;
  let transportError = "";
  let finalUsedAccount: any = null;
  let lastClassified: ReturnType<typeof classifyError> | null = null;

  // Rotation: try each account up to 3 times, then switch to next
  for (const account of healthyAccounts) {
    let accountGaveUp = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const transporter = nodemailer.createTransport({
          host: account.smtpHost,
          port: Number(account.smtpPort),
          secure: Boolean(account.secure),
          auth: {
            user: account.email,
            pass: account.appPassword,
          },
          connectionTimeout: 15000,
          greetingTimeout: 15000,
          socketTimeout: 15000,
          tls: { rejectUnauthorized: false },
        });

        await transporter.verify();

        await transporter.sendMail({
          from: `"${account.senderName}" <${(account as any).fromEmail || account.email}>`,
          replyTo: account.replyToEmail || (account as any).fromEmail || account.email,
          to: item.email,
          cc: item.cc || undefined,
          bcc: item.bcc || undefined,
          subject: compiledSubject,
          html: finalHtml,
          text: finalText || undefined,
          attachments: attachmentsList,
        });

        transportSuccess = true;
        finalUsedAccount = account;
        accountGaveUp = false;
        break;
      } catch (err: any) {
        transportError = err?.message || String(err);
        console.error(`SMTP ERROR on ${account.email} attempt ${attempt}/3:`, err);

        const classified = classifyError(transportError);
        lastClassified = classified;

        const newErrCount = (account.errorCount || 0) + 1;
        const cooldownTime = new Date();

        if (classified.type === "auth") {
          cooldownTime.setMinutes(cooldownTime.getMinutes() + 30);
        } else if (classified.type === "rate_limit") {
          cooldownTime.setMinutes(cooldownTime.getMinutes() + 5);
        } else {
          cooldownTime.setSeconds(cooldownTime.getSeconds() + 20);
        }

        await db
          .update(gmailAccounts)
          .set({
            errorCount: newErrCount,
            status:
              classified.shouldDisableAccount || newErrCount >= 5
                ? "disabled"
                : "enabled",
            cooldownUntil: cooldownTime,
            lastUsedAt: new Date(),
          })
          .where(eq(gmailAccounts.id, account.id));

        if (classified.type === "permanent" || classified.type === "auth") {
          accountGaveUp = true;
          break; // don't retry this account; try next
        }

        if (attempt >= 3) {
          accountGaveUp = true;
          break; // 3 failures → next SMTP
        }
        // brief pause before retry
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (transportSuccess) break;
    if (lastClassified?.type === "permanent") break;
  }

  // 8. Success
  if (transportSuccess && finalUsedAccount) {
    const cooldownUntil = new Date();
    cooldownUntil.setSeconds(cooldownUntil.getSeconds() + 20);

    await db
      .update(gmailAccounts)
      .set({
        sentToday: (finalUsedAccount.sentToday || 0) + 1,
        sentThisMinute: (finalUsedAccount.sentThisMinute || 0) + 1,
        lastUsedAt: new Date(),
        cooldownUntil,
        errorCount: 0,
      })
      .where(eq(gmailAccounts.id, finalUsedAccount.id));

    await db
      .update(queue)
      .set({
        status: "sent",
        gmailUsedId: finalUsedAccount.id,
        gmailUsedEmail: finalUsedAccount.email,
        sentAt: new Date(),
        errorMessage: null,
        retryAfter: null,
        lastErrorType: null,
      })
      .where(eq(queue.id, item.id));

    try {
      const rows = await readRows();
      const sheetRow = rows.find(
        (r) =>
          r.serialNo?.trim() === item.serialNo?.trim() ||
          r.referenceNo?.trim() === item.referenceNo?.trim()
      );
      if (sheetRow) {
        await updateRow(sheetRow.rowNumber, {
          status: "Sent",
          sentAt: new Date().toISOString(),
          gmailUsed: finalUsedAccount.email,
          trackingId: item.trackingId,
        });
      }
    } catch (err) {
      console.error("Google Sheet update failed", err);
    }

    return {
      success: true,
      gmailUsedEmail: finalUsedAccount.email,
      gmailUsedId: finalUsedAccount.id,
      processedItemId: item.id,
    };
  }

  // 9. All failed / permanent fail
  const classified = lastClassified || classifyError(transportError);
  const maxTries = item.maxTries || 3;

  // Permanent error → failed immediately
  if (!classified.retryable || classified.type === "permanent") {
    await db
      .update(queue)
      .set({
        status: "failed",
        errorMessage: transportError,
        lastErrorType: classified.type,
        retryAfter: null,
      })
      .where(eq(queue.id, item.id));

    return {
      success: false,
      error: transportError || "Permanent failure",
      processedItemId: item.id,
    };
  }

  // Max tries reached
  if (currentTries >= maxTries) {
    await db
      .update(queue)
      .set({
        status: "failed",
        errorMessage: `Max retries (${maxTries}) reached. Last error: ${transportError}`,
        lastErrorType: classified.type,
        retryAfter: null,
      })
      .where(eq(queue.id, item.id));

    return {
      success: false,
      error: `Max retries reached: ${transportError}`,
      processedItemId: item.id,
    };
  }

  // Temporary / rate_limit → schedule retry with backoff
  const backoffSec = getBackoffSeconds(currentTries);
  const retryAfter = new Date();
  retryAfter.setSeconds(retryAfter.getSeconds() + backoffSec);

  await db
    .update(queue)
    .set({
      status: "pending",
      errorMessage: transportError,
      lastErrorType: classified.type,
      retryAfter,
    })
    .where(eq(queue.id, item.id));

  return {
    success: false,
    error: `Retry scheduled in ${backoffSec}s. Last error: ${transportError}`,
    processedItemId: item.id,
  };
}
