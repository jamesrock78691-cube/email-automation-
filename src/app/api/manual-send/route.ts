import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { gmailAccounts } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { appendManualSentLog } from "@/app/services/googleSheets";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      fromName,
      fromEmail,
      to,
      cc,
      bcc,
      replyTo,
      subject,
      html,
      text,
      smtpAccountId,
      // optional extra fields for sheet log
      referenceNo,
      serialNo,
      markName,
      filingDate,
      templateName,
      sentByUserId,
      sentByUsername,
    } = body;

    if (!to || !subject || !html) {
      return NextResponse.json(
        { success: false, error: "To, Subject and Message are required" },
        { status: 400 }
      );
    }

    let account: any = null;
    const now = new Date();

    if (smtpAccountId) {
      const rows = await db
        .select()
        .from(gmailAccounts)
        .where(
          and(
            eq(gmailAccounts.id, Number(smtpAccountId)),
            eq(gmailAccounts.status, "enabled")
          )
        )
        .limit(1);
      account = rows[0] || null;
    } else {
      const rows = await db
        .select()
        .from(gmailAccounts)
        .where(eq(gmailAccounts.status, "enabled"))
        .orderBy(desc(gmailAccounts.priority));

      account =
        rows.find(
          (a) =>
            (!a.cooldownUntil || a.cooldownUntil <= now) &&
            (a.sentToday || 0) < (a.dailyLimit || 500)
        ) || null;
    }

    if (!account) {
      return NextResponse.json(
        { success: false, error: "No available SMTP account" },
        { status: 400 }
      );
    }

    const transporter = nodemailer.createTransport({
      host: account.smtpHost,
      port: Number(account.smtpPort),
      secure: Boolean(account.secure),
      auth: {
        user: account.email,
        pass: account.appPassword,
      },
      tls: { rejectUnauthorized: false },
    });

    await transporter.verify();

    const displayFrom = fromEmail || (account as any).fromEmail || account.email;
    const displayName = fromName || account.senderName || account.email;
    const trackingId = randomUUID();

    await transporter.sendMail({
      from: `"${displayName}" <${displayFrom}>`,
      replyTo: replyTo || account.replyToEmail || displayFrom,
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      html,
      text: text || undefined,
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

    // ===== Manual Sent Log sheet mein row add =====
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
        sentBy: sentByUsername || fromName || "unknown",
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
    });
  } catch (error: any) {
    console.error("Manual send error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to send email" },
      { status: 500 }
    );
  }
}
