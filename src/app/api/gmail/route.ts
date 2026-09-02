import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gmailAccounts, settings } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";

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

// GET accounts — role-aware, passwords hidden for operators
export async function GET(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const role = normalizeRole(session.role, session.username);
    let list: any[] = [];

    if (role === "operator") {
      const assignments = await getSmtpAssignments();
      const allowedIds: number[] = (
        assignments[String(session.userId)] ||
        assignments[session.username] ||
        []
      )
        .map((id: any) => Number(id))
        .filter((id: number) => !isNaN(id) && id > 0);

      if (allowedIds.length > 0) {
        list = await db
          .select()
          .from(gmailAccounts)
          .where(inArray(gmailAccounts.id, allowedIds))
          .orderBy(gmailAccounts.id);
      } else {
        list = [];
      }

      // Always strip password for operators
      list = list.map((a) => {
        const { appPassword, ...rest } = a;
        return rest;
      });
    } else {
      // admin / super_admin see everything
      list = await db.select().from(gmailAccounts).orderBy(gmailAccounts.id);
    }

    return NextResponse.json({ success: true, list });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

// POST: Add new account (admin/super only)
export async function POST(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const role = normalizeRole(session.role, session.username);
    if (role === "operator") {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

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

// PUT: Update account (admin/super only)
export async function PUT(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const role = normalizeRole(session.role, session.username);
    if (role === "operator") {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

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

// DELETE: Remove account (admin/super only)
export async function DELETE(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const role = normalizeRole(session.role, session.username);
    if (role === "operator") {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

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
