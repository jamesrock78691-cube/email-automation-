import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { gmailAccounts, settings } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { shouldResetDailyQuota } from "@/lib/dailyQuota";
import { workspaceFromRequest, workspaceSql, resolveWorkspace } from "@/lib/workspace";

const SECRET =
  process.env.AUTH_SECRET ||
  process.env.DATABASE_URL ||
  "email-automation-v1-dev-secret-change-me";

function verifyToken(token: string): {
  userId: number;
  username: string;
  role: string;
  workspace?: string;
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
      workspace: payload.workspace,
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

async function getSmtpAssignments(ws: string): Promise<Record<string, number[]>> {
  try {
    const key =
      !ws || ws === "main" ? "smtp_assignments" : `smtp_assignments__${ws}`;
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
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
    const ws = resolveWorkspace(session.username, session.workspace);
    let list: any[] = [];

    if (role === "operator") {
      const assignments = await getSmtpAssignments(ws);
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
          .where(
            and(
              inArray(gmailAccounts.id, allowedIds),
              workspaceSql(gmailAccounts.workspace, ws)
            )
          )
          .orderBy(gmailAccounts.id);
      } else {
        list = [];
      }

      list = list.map((a) => {
        const { appPassword, ...rest } = a;
        return rest;
      });
    } else {
      list = await db
        .select()
        .from(gmailAccounts)
        .where(workspaceSql(gmailAccounts.workspace, ws))
        .orderBy(gmailAccounts.id);
    }

    const now = new Date();
    for (let i = 0; i < list.length; i++) {
      const acc = list[i];
      if (acc.status === "cooldown") {
        const coolDone =
          !acc.cooldownUntil || new Date(acc.cooldownUntil) <= now;
        if (coolDone) {
          try {
            await db
              .update(gmailAccounts)
              .set({ status: "enabled", cooldownUntil: null })
              .where(eq(gmailAccounts.id, acc.id));
            list[i] = { ...list[i], status: "enabled", cooldownUntil: null };
          } catch {
            /* ignore */
          }
        }
      }
      if (shouldResetDailyQuota(acc.lastUsedAt, now) && (acc.sentToday || 0) > 0) {
        try {
          await db
            .update(gmailAccounts)
            .set({ sentToday: 0 })
            .where(eq(gmailAccounts.id, acc.id));
          list[i] = { ...acc, sentToday: 0 };
        } catch {
          list[i] = { ...acc, sentToday: 0 };
        }
      }
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
      smtpUsername,
      fromEmail,
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

    const ws = resolveWorkspace(session.username, session.workspace);

    const inserted = await db
      .insert(gmailAccounts)
      .values({
        email: String(email).trim().toLowerCase(),
        smtpUsername: smtpUsername || null,
        fromEmail: fromEmail || email,
        senderName: senderName || "Trademark Processing Department",
        replyToEmail: replyToEmail || null,
        provider: provider || "gmail",
        appPassword,
        smtpHost: smtpHost || "smtp.gmail.com",
        smtpPort: smtpPort ? Number(smtpPort) : 465,
        secure:
          secure !== undefined ? Boolean(secure) : Number(smtpPort) === 465,
        priority: priority ? Number(priority) : 1,
        dailyLimit: dailyLimit ? Number(dailyLimit) : 500,
        minuteLimit: minuteLimit ? Number(minuteLimit) : 50,
        status: status || "enabled",
        workspace: ws,
      })
      .returning();

    return NextResponse.json({ success: true, account: inserted[0] });
  } catch (error: any) {
    const msg = String(error?.message || error || "");
    const cause = String(error?.cause?.message || error?.cause || "");
    const full = msg + " " + cause;
    if (
      /unique|duplicate|already exists/i.test(full) ||
      /gmail_accounts_email/i.test(full)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Ye email pehle se add hai. Gmail list mein check karo, ya dusra account use karo.",
        },
        { status: 409 }
      );
    }
    if (/workspace|column .* does not exist/i.test(full)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "DB workspace column missing — page refresh karke 10 sec wait, phir dubara try.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { success: false, error: msg || "Failed to add account" },
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
      smtpUsername,
      fromEmail,
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

    if (email !== undefined) updates.email = String(email).trim().toLowerCase();
    if (smtpUsername !== undefined) updates.smtpUsername = smtpUsername || null;
    if (fromEmail !== undefined) updates.fromEmail = fromEmail || null;
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
    if (status !== undefined) {
      updates.status = status;
      if (String(status).toLowerCase() === "disabled") {
        updates.cooldownUntil = null;
      }
    }

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
    const msg = String(error?.message || "");
    if (/unique|duplicate/i.test(msg)) {
      return NextResponse.json(
        { success: false, error: "Ye email pehle se kisi account pe hai." },
        { status: 409 }
      );
    }
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

    const ws = resolveWorkspace(session.username, session.workspace);
    await db
      .delete(gmailAccounts)
      .where(
        and(
          eq(gmailAccounts.id, Number(id)),
          workspaceSql(gmailAccounts.workspace, ws)
        )
      );

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
