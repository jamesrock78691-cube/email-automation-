import fs from "fs";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { gmailAccounts, queue, templates, campaigns, settings } from "@/db/schema";
import { eq, asc, and, or, isNull, lte } from "drizzle-orm";
import { toSendableEmailHtml } from "@/lib/quillToEmailHtml";
import { readRows, updateRow } from "@/app/services/googleSheets";
import {
  buildTrackingPixelHtml,
  injectTrackingPixel,
  getAppBaseUrl,
} from "@/lib/trackingPixel";
import { smtpFromAddress, createSmtpTransport } from "@/lib/smtpAccount";
import { workspaceSql, MAIN_WORKSPACE } from "@/lib/workspace";
import { loadTemplateAttachments } from "@/lib/loadTemplateAttachments";

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

function classifyError(errorMessage: string): {
  type: "auth" | "rate_limit" | "permanent" | "temporary";
  shouldDisableAccount: boolean;
  retryable: boolean;
  isDailyLimit: boolean;
} {
  const msg = (errorMessage || "").toLowerCase();
  if (
    msg.includes("daily user sending limit") ||
    msg.includes("daily sending limit") ||
    msg.includes("5.4.5") ||
    msg.includes("rate limit") ||
    msg.includes("too many") ||
    msg.includes("throttl") ||
    msg.includes("try again") ||
    msg.includes("quota") ||
    msg.includes("421") ||
    msg.includes("450") ||
    msg.includes("452") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("socket") ||
    msg.includes("greeting") ||
    msg.includes("connection")
  ) {
    const isDaily =
      msg.includes("daily") ||
      msg.includes("5.4.5") ||
      msg.includes("quota exceeded");
    return {
      type: "rate_limit",
      shouldDisableAccount: false,
      retryable: true,
      isDailyLimit: isDaily,
    };
  }
  if (
    msg.includes("invalid login") ||
    msg.includes("authentication failed") ||
    msg.includes("username and password not accepted") ||
    msg.includes("badcredentials") ||
    msg.includes("535") ||
    msg.includes("534")
  ) {
    return {
      type: "auth",
      shouldDisableAccount: false,
      retryable: true,
      isDailyLimit: false,
    };
  }
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
    return {
      type: "permanent",
      shouldDisableAccount: false,
      retryable: false,
      isDailyLimit: false,
    };
  }
  return {
    type: "temporary",
    shouldDisableAccount: false,
    retryable: true,
    isDailyLimit: false,
  };
}

function getBackoffSeconds(tries: number): number {
  const map: Record<number, number> = { 1: 30, 2: 120, 3: 300 };
  return map[tries] || 600;
}

export async function processNextQueueItem(
  baseUrl: string,
  ws: string = MAIN_WORKSPACE
): Promise<SendResult> {
  const now = new Date();
  const todayLocal = now.toLocaleDateString("en-CA");

  const pendingItems = await db
    .select()
    .from(queue)
    .where(
      and(
        eq(queue.status, "pending"),
        or(isNull(queue.retryAfter), lte(queue.retryAfter, now)),
        workspaceSql(queue.workspace, ws)
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

  let trackingId = String(item.trackingId || "").trim();
  if (!trackingId) {
    trackingId = randomUUID();
    await db
      .update(queue)
      .set({ trackingId })
      .where(eq(queue.id, item.id));
    item.trackingId = trackingId;
  }

  const pixelBase =
    getAppBaseUrl() ||
    (baseUrl && !/localhost|127\\.0\\.0\\.1/i.test(baseUrl) ? baseUrl : "");

  const accounts = await db
    .select()
    .from(gmailAccounts)
    .where(workspaceSql(gmailAccounts.workspace, ws));

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

    if (acc.cooldownUntil && acc.cooldownUntil <= now) {
      updates.cooldownUntil = null;
      needsUpdate = true;
    }
    if (acc.status === "cooldown") {
      const coolDone = !acc.cooldownUntil || acc.cooldownUntil <= now;
      if (coolDone) {
        updates.status = "enabled";
        needsUpdate = true;
        acc.status = "enabled";
      }
    }

    if (needsUpdate) {
      await db
        .update(gmailAccounts)
        .set(updates)
        .where(eq(gmailAccounts.id, acc.id));

      if (updates.sentToday !== undefined) acc.sentToday = updates.sentToday;
      if (updates.sentThisMinute !== undefined)
        acc.sentThisMinute = updates.sentThisMinute;
      if (updates.cooldownUntil === null) acc.cooldownUntil = null as any;
    }
  }

  const healthyAccounts = accounts.filter((acc) => {
    if (acc.status && acc.status !== "enabled") return false;
    if (acc.cooldownUntil && acc.cooldownUntil > now) return false;
    if ((acc.sentToday || 0) >= acc.dailyLimit) return false;
    if ((acc.sentThisMinute || 0) >= acc.minuteLimit) return false;
    return true;
  });

  if (healthyAccounts.length === 0) {
    const retryAfter = new Date();
    retryAfter.setMinutes(retryAfter.getMinutes() + 5);

    await db
      .update(queue)
      .set({
        status: "pending",
        retryAfter,
        lastErrorType: "rate_limit",
        errorMessage:
          "No available Gmail/SMTP accounts right now (limit or cooldown). Will retry later.",
      })
      .where(eq(queue.id, item.id));

    return {
      success: false,
      error: "No available Gmail accounts right now.",
      processedItemId: item.id,
    };
  }

  healthyAccounts.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    if ((a.errorCount || 0) !== (b.errorCount || 0))
      return (a.errorCount || 0) - (b.errorCount || 0);
    const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
    const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
    return aTime - bTime;
  });

  const todayStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const trackingPixelHtml = buildTrackingPixelHtml(
    pixelBase,
    trackingId,
    item.email
  );

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
    }
  }

  if (!rawHtml) {
    console.error(
      "No template found for queue item id:",
      item.id,
      "templateId:",
      resolvedTemplateId
    );
    await db
      .update(queue)
      .set({
        status: "failed",
        errorMessage: "No template resolved - check templateId on queue/campaign",
      })
      .where(eq(queue.id, item.id));

    return {
      success: false,
      error: "No template found",
      processedItemId: item.id,
    };
  }

  const compiledHtml = toSendableEmailHtml(compileTemplate(rawHtml, variables));
  const finalHtml = injectTrackingPixel(compiledHtml, trackingPixelHtml);

  let attachmentsList: any[] = [];
  try {
    if (resolvedTemplateId) {
      const tmpl = await db
        .select()
        .from(templates)
        .where(eq(templates.id, resolvedTemplateId))
        .limit(1);
      if (tmpl.length) {
        attachmentsList = await loadTemplateAttachments(
          tmpl[0].attachmentsJson,
          resolvedTemplateId
        );
      }
    }
  } catch (err) {
    console.error("Attachment parse error", err);
  }

  await db
    .update(queue)
    .set({
      status: "sending",
      tries: item.tries + 1,
    })
    .where(eq(queue.id, item.id));

  const currentTries = item.tries + 1;

  let transportSuccess = false;
  let transportError = "";
  let finalUsedAccount: any = null;
  let lastClassified: ReturnType<typeof classifyError> | null = null;

  for (const account of healthyAccounts) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const transporter = createSmtpTransport(account);

        await transporter.sendMail({
          from: `"${account.senderName}" <${smtpFromAddress(account)}>`,
          replyTo: account.replyToEmail || smtpFromAddress(account),
          to: item.email,
          cc: item.cc || undefined,
          bcc: item.bcc || undefined,
          subject: compiledSubject,
          html: finalHtml,
          attachments: attachmentsList,
        });

        transportSuccess = true;
        finalUsedAccount = account;
        break;
      } catch (err: any) {
        transportError = err?.message || String(err);
        console.error(
          `SMTP ERROR on ${account.email} attempt ${attempt}/3:`,
          err
        );

        const classified = classifyError(transportError);
        lastClassified = classified;

        const newErrCount = (account.errorCount || 0) + 1;
        account.errorCount = newErrCount;
        const cooldownTime = new Date();

        if (classified.isDailyLimit) {
          cooldownTime.setHours(cooldownTime.getHours() + 18);
        } else if (classified.type === "rate_limit") {
          cooldownTime.setMinutes(cooldownTime.getMinutes() + 2);
        } else if (classified.type === "auth") {
          cooldownTime.setMinutes(cooldownTime.getMinutes() + 3);
        } else {
          cooldownTime.setSeconds(cooldownTime.getSeconds() + 20);
        }

        const accUpdate: any = {
          errorCount: newErrCount,
          status: "enabled",
          cooldownUntil: cooldownTime,
          lastUsedAt: new Date(),
        };
        if (classified.isDailyLimit) {
          accUpdate.sentToday = account.dailyLimit || 500;
        }
        await db
          .update(gmailAccounts)
          .set(accUpdate)
          .where(eq(gmailAccounts.id, account.id));

        if (classified.type === "permanent") break;
        if (classified.type === "auth" || classified.type === "rate_limit") break;
        if (classified.isDailyLimit) break;
        if (attempt >= 3) break;

        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (transportSuccess) break;
    if (lastClassified?.type === "permanent") break;
  }

  if (transportSuccess && finalUsedAccount) {
    const cooldownUntil = new Date();
    cooldownUntil.setSeconds(cooldownUntil.getSeconds() + 15);

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
          trackingId: trackingId,
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

  const classified = lastClassified || classifyError(transportError);
  const maxTries = item.maxTries || 3;

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
