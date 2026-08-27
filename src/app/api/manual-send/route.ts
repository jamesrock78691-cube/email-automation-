import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { db } from "@/db";
import { gmailAccounts, settings, users } from "@/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import { appendManualSentLog } from "@/app/services/googleSheets";
import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { quillToEmailHtml } from "@/lib/quillToEmailHtml";

const SECRET =
  process.env.AUTH_SECRET ||
  process.env.DATABASE_URL ||
  "email-automation-v1-dev-secret-change-me";

function verifyToken(token: string): {
  userId: number;
  username: string;
  role: string;
} | null {
  try {
    if (!token || !token.includes(".")) return null;
    const [payloadB64, sig] = token.split(".");
    const expected = createHmac("sha256", SECRET)
      .update(payloadB64)
      .digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const payload = JSON.parse(json);
    if (!payload?.userId || Date.now() > payload.exp) return null;
    return {
      userId: payload.userId,
      username: payload.username || "",
      role: payload.role || "operator",
    };
  } catch {
    return null;
  }
}

function getSession(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : req.cookies.get("ea_session")?.value;
  if (!token) return null;
  return verifyToken(token);
}

function normalizeRole(role: string, username?: string) {
  const r = (role || "").toLowerCase().trim();
  if (
    r === "super_admin" ||
    username === "admin" ||
    username === "superadmin"
  ) {
    return "super_admin";
  }
  if (r === "admin") return "admin";
  return "operator";
}

async function getSmtpAssignments(): Promise<Record<string, number[]>> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "smtp_assignments"))
      .limit(1);
    if (!rows.length) return {};
    const map = JSON.parse(rows[0].value || "{}");
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

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

    const role = normalizeRole(session.role, session.username);
    const now = new Date();
    let account: any = null;

    // Operator → only assigned SMTPs
    if (role === "operator") {
      const assignments = await getSmtpAssignments();
      const allowedIds: number[] = (
        assignments[String(session.userId)] ||
        assignments[session.username] ||
        []
      )
        .map((id: any) => Number(id))
        .filter((id: number) => !isNaN(id) && id > 0);

      if (allowedIds.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: "No SMTP accounts assigned to you. Contact Super Admin.",
          },
          { status: 403 }
        );
      }

      if (smtpAccountId) {
        const wanted = Number(smtpAccountId);
        if (!allowedIds.includes(wanted)) {
          return NextResponse.json(
            {
              success: false,
              error: "This SMTP is not assigned to you.",
            },
            { status: 403 }
          );
        }
        const rows = await db
          .select()
          .from(gmailAccounts)
          .where(
            and(
              eq(gmailAccounts.id, wanted),
              eq(gmailAccounts.status, "enabled")
            )
          )
          .limit(1);
        account = rows[0] || null;
      } else {
        const rows = await db
          .select()
          .from(gmailAccounts)
          .where(
            and(
              inArray(gmailAccounts.id, allowedIds),
              eq(gmailAccounts.status, "enabled")
            )
          )
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
          {
            success: false,
            error: "No available assigned SMTP account right now.",
          },
          { status: 400 }
        );
      }
    } else {
      // Admin / Super Admin → any enabled
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

    const displayFrom =
      fromEmail || (account as any).fromEmail || account.email;
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
        sentBy: sentByUsername || session.username || "",
        sentById: sentByUserId || String(session.userId) || "",
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
