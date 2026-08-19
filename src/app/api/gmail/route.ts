import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gmailAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";

// GET accounts
export async function GET() {
  try {
    const list = await db.select().from(gmailAccounts).orderBy(gmailAccounts.id);
    return NextResponse.json({ success: true, list });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST: Add new account
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      email,
      senderName,
      replyToEmail,
      provider,
      appPassword,
      smtpHost,
      smtpPort,
      secure,
      priority,
      dailyLimit,
      minuteLimit,
      status,
    } = body;

    if (!email || !appPassword) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    const inserted = await db
      .insert(gmailAccounts)
      .values({
        email,
        senderName: senderName || "Trademark Processing Department",
        replyToEmail: replyToEmail || null,
        provider: provider || "gmail",
        appPassword,
        smtpHost: smtpHost || "smtp.gmail.com",
        smtpPort: smtpPort ? Number(smtpPort) : 465,
        secure: secure !== undefined ? Boolean(secure) : true,
        priority: priority ? Number(priority) : 1,
        dailyLimit: dailyLimit ? Number(dailyLimit) : 500,
        minuteLimit: minuteLimit ? Number(minuteLimit) : 50,
        status: status || "enabled",
      })
      .returning();

    return NextResponse.json({ success: true, account: inserted[0] });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// PUT: Update account
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      id,
      email,
      senderName,
      replyToEmail,
      provider,
      appPassword,
      smtpHost,
      smtpPort,
      secure,
      priority,
      dailyLimit,
      minuteLimit,
      status,
      resetLimits,
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Account ID is required" },
        { status: 400 }
      );
    }

    const updates: any = {};

    if (email !== undefined) updates.email = email;
    if (senderName !== undefined) updates.senderName = senderName;
    if (replyToEmail !== undefined) updates.replyToEmail = replyToEmail;
    if (provider !== undefined) updates.provider = provider;
    if (appPassword !== undefined) updates.appPassword = appPassword;
    if (smtpHost !== undefined) updates.smtpHost = smtpHost;
    if (smtpPort !== undefined) updates.smtpPort = Number(smtpPort);
    if (secure !== undefined) updates.secure = Boolean(secure);
    if (priority !== undefined) updates.priority = Number(priority);
    if (dailyLimit !== undefined) updates.dailyLimit = Number(dailyLimit);
    if (minuteLimit !== undefined) updates.minuteLimit = Number(minuteLimit);
    if (status !== undefined) updates.status = status;

    if (resetLimits) {
      updates.sentToday = 0;
      updates.sentThisMinute = 0;
      updates.errorCount = 0;
      updates.cooldownUntil = null;
    }

    const updated = await db
      .update(gmailAccounts)
      .set(updates)
      .where(eq(gmailAccounts.id, Number(id)))
      .returning();

    return NextResponse.json({ success: true, account: updated[0] });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// DELETE: Remove account
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Account ID is required" },
        { status: 400 }
      );
    }

    await db.delete(gmailAccounts).where(eq(gmailAccounts.id, Number(id)));

    return NextResponse.json({
      success: true,
      message: "Account deleted successfully",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}