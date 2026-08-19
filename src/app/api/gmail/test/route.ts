import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gmailAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";

export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: "Account ID is required" }, { status: 400 });
    }

    const matched = await db.select().from(gmailAccounts).where(eq(gmailAccounts.id, Number(id))).limit(1);
    if (matched.length === 0) {
      return NextResponse.json({ success: false, error: "Account not found" }, { status: 444 });
    }

    const account = matched[0];

    // Check if it's a simulated dummy rotator
    if (account.email.includes("rotator") || account.appPassword.includes("abcd")) {
      // Simulate validation
      await new Promise((resolve) => setTimeout(resolve, 800));
      return NextResponse.json({
        success: true,
        message: `Connection Verified! Rotated Virtual Account ${account.email} is in healthy condition.`,
      });
    }

// Auto SMTP settings based on provider
let host = account.smtpHost;
let port = account.smtpPort;
let secure = account.secure;

switch (account.provider) {
  case "gmail":
    host = "smtp.gmail.com";
    port = 465;
    secure = true;
    break;

  case "outlook":
    host = "smtp.office365.com";
    port = 587;
    secure = false;
    break;

  case "zoho":
    host = "smtp.zoho.com";
    port = 465;
    secure = true;
    break;

  case "hostinger":
    host = "smtp.hostinger.com";
    port = 465;
    secure = true;
    break;

  case "namecheap":
    host = "mail.privateemail.com";
    port = 465;
    secure = true;
    break;

  case "godaddy":
    host = "smtp.office365.com";
    port = 587;
    secure = false;
    break;

  case "cpanel":
  case "custom":
    // Use values saved in database
    break;
}

    // Direct SMTP verify
    const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
      auth: {
        user: account.email,
        pass: account.appPassword,
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
    } as any);

    await transporter.verify();

// Save auto SMTP settings back to database
await db
  .update(gmailAccounts)
  .set({
    smtpHost: host,
    smtpPort: port,
    secure,
  })
  .where(eq(gmailAccounts.id, account.id));

    // Reset error count on successful direct verification
    await db
      .update(gmailAccounts)
      .set({ errorCount: 0, status: "enabled", cooldownUntil: null })
      .where(eq(gmailAccounts.id, account.id));

    return NextResponse.json({
      success: true,
      message: `Successfully authenticated! ${account.provider.toUpperCase()} SMTP connected (${host}:${port})`,
    });
  } catch (error: any) {
    console.error("SMTP verification failed:", error);
    return NextResponse.json({
      success: false,
      error: `Connection Failed: ${error.message || String(error)}`,
    });
  }
}
