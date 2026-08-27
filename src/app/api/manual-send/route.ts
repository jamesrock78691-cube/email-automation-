import { NextRequest, NextResponse } from "next/server";
import { quillToEmailHtml } from "@/lib/quillToEmailHtml";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { gmailAccounts, settings } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { appendManualSentLog } from "@/app/services/googleSheets";
import { randomUUID } from "crypto";

async function getSmtpAssignments(): Promise<Record<string, number[]>> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "smtp_assignments"))
      .limit(1);
    if (!rows.length || !rows[0].value) return {};
    const parsed = JSON.parse(rows[0].value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function accountAllowedForUser(
  accountId: number,
  userId: number | null | undefined,
  isSuper: boolean,
  map: Record<string, number[]>
): boolean {
  if (isSuper) return true;
  const assigned = map[String(accountId)] || [];
  if (assigned.length === 0) return true;
  if (userId == null) return false;
  return assigned.map(Number).includes(Number(userId));
}

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
      referenceNo,
      serialNo,
      markName,
      filingDate,
      templateName,
      sentByUserId,
      sentByUsername,
    } = body;

    const emailHtml = quillToEmailHtml(String(html || ""));

    if (!to || !subject || !html) {
      return NextResponse.json(
        { success: false, error: "To, Subject and Message are required" },
        { status: 400 }
      );
    }

    let account: any = null;
    const now = new Date();
    const assignMap = await getSmtpAssignments();
    const uid =
      sentByUserId != null && sentByUserId !== ""
        ? Number(sentByUserId)
        : null;
    const userIdNum = uid != null && !Number.isNaN(uid) ? uid : null;
    const isSuper =
      String(body.isSuperAdmin || "") === "true" ||
      String(body.role || "").toLowerCase() === "super_admin";

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
      if (
        account &&
        !accountAllowedForUser(account.id, userIdNum, isSuper, assignMap)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: "No SMTP accounts assigned to you. Contact Super Admin.",
          },
          { status: 403 }
        );
      }
    } else {
      const rows = await db
        .select()
        .from(gmailAccounts)
        .where(eq(gmailAccounts.status, "enabled"))
        .orderBy(desc(gmailAccounts.priority));

      const allowed = rows.filter((a) =>
        accountAllowedForUser(a.id, userIdNum, isSuper, assignMap)
      );

      if (allowed.length === 0 && rows.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: "No SMTP accounts assigned to you. Contact Super Admin.",
          },
          { status: 403 }
        );
      }

      account =
        allowed.find(
          (a) =>
            (!a.cooldownUntil || a.cooldownUntil <= now) &&
            (a.sentToday || 0) < (a.dailyLimit || 500)
        ) || null;
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
      html: emailHtml,
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
    });
  } catch (error: any) {
    console.error("Manual send error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to send email" },
      { status: 500 }
    );
  }
}
