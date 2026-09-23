import { NextRequest, NextResponse } from "next/server";
import { db, pool } from "@/db";
import { gmailAccounts, settings } from "@/db/schema";
import { eq, inArray, and } from "drizzle-orm";
import { shouldResetDailyQuota } from "@/lib/dailyQuota";
import { workspaceSql } from "@/lib/workspace";
import {
  getSessionFromRequest,
  normalizeRole,
} from "@/lib/authSession";

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

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const role = normalizeRole(session.role, session.username);
    const ws = session.workspace;
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
      }
      list = list.map(({ appPassword, ...rest }) => rest);
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

    console.log(`[GMAIL GET] user=${session.username} ws=${ws} count=${list.length}`);
    return NextResponse.json({ success: true, list, workspace: ws });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
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

    const ws = session.workspace;
    const emailNorm = String(email).trim().toLowerCase();

    // Force workspace via raw SQL so it can never default to main
    const port = smtpPort ? Number(smtpPort) : 465;
    const isSecure =
      secure !== undefined ? Boolean(secure) : port === 465;

    const result = await pool.query(
      `INSERT INTO gmail_accounts (
         email, smtp_username, from_email, sender_name, reply_to_email,
         provider, app_password, smtp_host, smtp_port, secure,
         priority, daily_limit, minute_limit, status, workspace
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15
       )
       RETURNING *`,
      [
        emailNorm,
        smtpUsername || null,
        fromEmail || emailNorm,
        senderName || "Trademark Processing Department",
        replyToEmail || null,
        provider || "gmail",
        appPassword,
        smtpHost || "smtp.gmail.com",
        port,
        isSecure,
        priority ? Number(priority) : 1,
        dailyLimit ? Number(dailyLimit) : 500,
        minuteLimit ? Number(minuteLimit) : 50,
        status || "enabled",
        ws,
      ]
    );

    const account = result.rows[0];
    console.log(
      `[GMAIL POST] user=${session.username} ws=${ws} email=${emailNorm} id=${account?.id}`
    );
    return NextResponse.json({ success: true, account, workspace: ws });
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
            "Ye email is workspace mein pehle se add hai. Dusra email use karo.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { success: false, error: msg || "Failed to add account" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
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

    const ws = session.workspace;

    // Only touch accounts in THIS workspace
    const existing = await db
      .select()
      .from(gmailAccounts)
      .where(
        and(
          eq(gmailAccounts.id, Number(id)),
          workspaceSql(gmailAccounts.workspace, ws)
        )
      )
      .limit(1);

    if (!existing.length) {
      return NextResponse.json(
        {
          success: false,
          error: "Account not found in your workspace",
        },
        { status: 404 }
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
    // Never allow client to change workspace
    updates.workspace = ws;

    const updated = await db
      .update(gmailAccounts)
      .set(updates)
      .where(
        and(
          eq(gmailAccounts.id, Number(id)),
          workspaceSql(gmailAccounts.workspace, ws)
        )
      )
      .returning();

    return NextResponse.json({
      success: true,
      account: updated[0],
      workspace: ws,
    });
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

export async function DELETE(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
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

    const ws = session.workspace;
    const deleted = await db
      .delete(gmailAccounts)
      .where(
        and(
          eq(gmailAccounts.id, Number(id)),
          workspaceSql(gmailAccounts.workspace, ws)
        )
      )
      .returning();

    if (!deleted.length) {
      return NextResponse.json(
        { success: false, error: "Account not found in your workspace" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Account deleted successfully",
      workspace: ws,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
