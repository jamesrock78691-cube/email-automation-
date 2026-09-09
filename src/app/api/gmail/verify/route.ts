import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export async function POST(request: NextRequest) {
  try {
    const {
      provider,
      email,
      smtpUsername,
      password,
      smtpHost,
      smtpPort,
      secure,
    } = await request.json();

    const loginUser = String(smtpUsername || email || "").trim();

    if (!loginUser || !password) {
      return NextResponse.json(
        {
          success: false,
          error: "SMTP username/email and password are required.",
        },
        { status: 400 }
      );
    }

    let host = smtpHost;
    let port = Number(smtpPort);
    let isSecure = secure;

    switch ((provider || "").toLowerCase()) {
      case "gmail":
        host = "smtp.gmail.com";
        port = 465;
        isSecure = true;
        break;

      case "outlook":
        host = "smtp.office365.com";
        port = 587;
        isSecure = false;
        break;

      case "zoho":
        host = "smtp.zoho.com";
        port = 465;
        isSecure = true;
        break;

      case "hostinger":
        host = "smtp.hostinger.com";
        port = Number(smtpPort);
        isSecure = port === 465;
        break;

      case "brevo":
        host = "smtp-relay.brevo.com";
        port = Number(smtpPort) || 587;
        isSecure = port === 465;
        break;

      case "namecheap":
        host = "mail.privateemail.com";
        port = Number(smtpPort);
        isSecure = port === 465;
        break;

      case "custom":
      case "cpanel":
      default:
        host = smtpHost;
        port = Number(smtpPort);
        isSecure = port === 465;
        break;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: isSecure,

      auth: {
        user: loginUser,
        pass: password.trim(),
      },

      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,

      tls: {
        rejectUnauthorized: false,
      },
    });

    await transporter.verify();

    return NextResponse.json({
      success: true,
      message: `SMTP connection successful (${host}:${port})`,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message || String(err),
    });
  }
}