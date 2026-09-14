import { NextRequest, NextResponse } from "next/server";
import { toSendableEmailHtml } from "@/lib/quillToEmailHtml";
import { db } from "@/db";
import { gmailAccounts, settings } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { appendManualSentLog } from "@/app/services/googleSheets";
import { randomUUID } from "crypto";
import { shouldResetDailyQuota } from "@/lib/dailyQuota";
import {
  buildTrackingPixelHtml,
  getAppBaseUrl,
  injectTrackingPixel,
} from "@/lib/trackingPixel";
import { smtpFromAddress, createSmtpTransport } from "@/lib/smtpAccount";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      to,
      subject,
      html,
      cc,
      bcc,
      fromName,
      fromEmail,
      replyTo,
      referenceNo,
      serialNo,
      markName,
      filingDate,
      templateName,
      sentByUsername,
      sentByUserId,
      smtpAccountId,
    } = body;

    const emailHtml = toSendableEmailHtml(String(html || ""));

    if (!to || !subject || !html) {
      return NextResponse.json(
        { success: false, error: "To, Subject and Message are required" },
        { status: 400 }
      );
    }

    // Pick SMTP account
    let account: any = null;
    if (smtpAccountId) {
      const rows = await db
        .select()
        .from(gmailAccounts)
        .where(eq(gmailAccounts.id, Number(smtpAccountId)))
        .limit(1);
      account = rows[0] || null;
    }

    if (!account) {
      const accounts = await db
        .select()
        .from(gmailAccounts)
        .where(eq(gmailAccounts.status, "enabled"))
        .orderBy(desc(gmailAccounts.priority));

      const now = new Date();
      for (const acc of accounts) {
        if (shouldResetDailyQuota(acc.lastUsedAt)) {
          await db
            .update(gmailAccounts)
            .set({ sentToday: 0, sentThisMinute: 0 })
            .where(eq(gmailAccounts.id, acc.id));
          acc.sentToday = 0;
          acc.sentThisMinute = 0;
        }
        if (acc.cooldownUntil && new Date(acc.cooldownUntil) > now) continue;
        if ((acc.sentToday || 0) >= (acc.dailyLimit || 500)) continue;
        account = acc;
        break;
      }
    }

    if (!account) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No available SMTP account (all disabled, cooldown, or daily limit reached).",
        },
        { status: 400 }
      );
    }

    const transporter = createSmtpTransport(account);

    const displayFrom = fromEmail || smtpFromAddress(account);
    const displayName = fromName || account.senderName || account.email;
    const trackingId = randomUUID();
    const pixelBase = getAppBaseUrl(request);
    const pixel = buildTrackingPixelHtml(pixelBase, trackingId);
    const htmlWithPixel = injectTrackingPixel(emailHtml, pixel);
    console.log(
      `[MANUAL SEND] trackingId=${trackingId} pixelBase=${pixelBase} htmlHasPixel=${htmlWithPixel.includes("/api/track/")}`
    );

    await transporter.sendMail({
      from: `"${displayName}" <${displayFrom}>`,
      replyTo: replyTo || account.replyToEmail || displayFrom,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      html: htmlWithPixel,
    });

    const cooldownUntil = new Date();
    cooldownUntil.setSeconds(cooldownUntil.getSeconds() + 20);

    await db
      .update(gmailAccounts)
      .set({
        sentToday: (account.sentToday || 0) + 1,
        sentThisMinute: (account.sentThisMinute || 0) + 1,
        lastUsedAt: new Date(),
        cooldownUntil,
        errorCount: 0,
      })
      .where(eq(gmailAccounts.id, account.id));

    // Persist trackingId → email in DB so pixel opens count without Google Sheets
    try {
      const mapRows = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "manual_track_map"))
        .limit(1);
      const map = mapRows.length
        ? JSON.parse(mapRows[0].value || "{}")
        : {};
      map[trackingId] = {
        email: to,
        subject: subject || "",
        markName: markName || "Manual Send",
        referenceNo: referenceNo || "MANUAL",
        sentAt: new Date().toISOString(),
        sentBy: sentByUsername || "",
      };
      const keys = Object.keys(map);
      if (keys.length > 500) {
        for (const k of keys.slice(0, keys.length - 500)) delete map[k];
      }
      if (mapRows.length) {
        await db
          .update(settings)
          .set({ value: JSON.stringify(map) })
          .where(eq(settings.key, "manual_track_map"));
      } else {
        await db.insert(settings).values({
          key: "manual_track_map",
          value: JSON.stringify(map),
        });
      }
    } catch (mapErr) {
      console.error("manual_track_map save failed:", mapErr);
    }

    try {
      await appendManualSentLog({
        referenceNo: referenceNo || "",
        serialNo: serialNo || "",
        markName: markName || "",
        filingDate: filingDate || "",
        email: to,
        cc: cc || "",
        bcc: bcc || "",
        subject,
        templateName: templateName || "",
        status: "Sent",
        sentAt: new Date().toISOString(),
        gmailUsed: account.email,
        sentBy: sentByUsername || "",
        sentById: sentByUserId || "",
        trackingId,
      });
    } catch (logErr) {
      console.error("Manual log sheet write failed (email still sent):", logErr);
    }

    return NextResponse.json({
      success: true,
      message: "Email sent successfully",
      usedAccount: account.email,
      trackingId,
      htmlLength: htmlWithPixel.length,
    });
  } catch (error: any) {
    console.error("Manual send error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to send email" },
      { status: 500 }
    );
  }
}
