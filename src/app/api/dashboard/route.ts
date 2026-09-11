import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  queue,
  gmailAccounts,
  templates,
  campaigns,
  trackingLogs,
  settings,
  users,
} from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { count, eq, desc, sql, inArray, and, or } from "drizzle-orm";
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

export async function GET(request: NextRequest) {
  try {
    await seedDatabase();

    const session = getSession(request);
    const role = session
      ? normalizeRole(session.role, session.username)
      : "operator";
    const isSuper = role === "super_admin";

    let operatorGmailIds: number[] = [];
    if (session && role === "operator") {
      const assignments = await getSmtpAssignments();
      operatorGmailIds = (
        assignments[String(session.userId)] ||
        assignments[session.username] ||
        []
      )
        .map((id: any) => Number(id))
        .filter((id: number) => !isNaN(id) && id > 0);
    }

    let totalCount = 0;
    let sentCount = 0;
    let pendingCount = 0;
    let sendingCount = 0;
    let failedCount = 0;
    let openedCount = 0;
    let uniqueOpens = 0;
    let totalOpenEvents = 0;

    if (session && role === "operator") {
      try {
        const statsRows = await db
          .select()
          .from(settings)
          .where(eq(settings.key, "agent_stats"))
          .limit(1);
        const statsMap = statsRows.length
          ? JSON.parse(statsRows[0].value || "{}")
          : {};
        const my = statsMap[String(session.userId)] || {};
        sentCount = Number(my.totalSent) || 0;
      } catch {
        sentCount = 0;
      }

      if (operatorGmailIds.length > 0) {
        const sentVia = await db
          .select({ value: count() })
          .from(queue)
          .where(
            and(eq(queue.status, "sent"), inArray(queue.gmailUsedId, operatorGmailIds))
          );
        const viaN = sentVia[0]?.value || 0;
        if (viaN > 0) sentCount = viaN;

        const openedVia = await db
          .select({ value: count() })
          .from(queue)
          .where(
            and(sql`${queue.openCount} > 0`, inArray(queue.gmailUsedId, operatorGmailIds))
          );
        openedCount = openedVia[0]?.value || 0;
        uniqueOpens = openedCount;

        const failedVia = await db
          .select({ value: count() })
          .from(queue)
          .where(
            and(eq(queue.status, "failed"), inArray(queue.gmailUsedId, operatorGmailIds))
          );
        failedCount = failedVia[0]?.value || 0;

        const pendingEmailsResult = await db
          .select({ value: count() })
          .from(queue)
          .where(eq(queue.status, "pending"));
        pendingCount = pendingEmailsResult[0]?.value || 0;

        const sendingEmailsResult = await db
          .select({ value: count() })
          .from(queue)
          .where(eq(queue.status, "sending"));
        sendingCount = sendingEmailsResult[0]?.value || 0;

        totalCount = sentCount + pendingCount + sendingCount + failedCount;
      } else {
        totalCount = sentCount;
      }
    } else {
      const totalEmailsResult = await db.select({ value: count() }).from(queue);
      totalCount = totalEmailsResult[0]?.value || 0;

      const sentEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(eq(queue.status, "sent"));
      sentCount = sentEmailsResult[0]?.value || 0;

      const pendingEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(eq(queue.status, "pending"));
      pendingCount = pendingEmailsResult[0]?.value || 0;

      const sendingEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(eq(queue.status, "sending"));
      sendingCount = sendingEmailsResult[0]?.value || 0;

      const failedEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(eq(queue.status, "failed"));
      failedCount = failedEmailsResult[0]?.value || 0;

      const openedResult = await db
        .select({ value: count() })
        .from(queue)
        .where(sql`${queue.openCount} > 0`);
      openedCount = openedResult[0]?.value || 0;

      const uniqueQueueOpens = await db
        .select({ value: sql<number>`count(distinct ${queue.email})` })
        .from(queue)
        .where(sql`${queue.openCount} > 0`);
      const uniqueManual = await db
        .select({
          value: sql<number>`count(distinct coalesce(${trackingLogs.email}, ${trackingLogs.trackingId}))`,
        })
        .from(trackingLogs)
        .where(sql`${trackingLogs.queueId} is null`);
      uniqueOpens =
        Number(uniqueQueueOpens[0]?.value || 0) +
        Number(uniqueManual[0]?.value || 0);

      const totalEvents = await db
        .select({ value: count() })
        .from(trackingLogs);
      totalOpenEvents = totalEvents[0]?.value || 0;
    }

    const activeGmailResult = await db
      .select({ value: count() })
      .from(gmailAccounts)
      .where(eq(gmailAccounts.status, "enabled"));
    const activeGmailCount = activeGmailResult[0]?.value || 0;

    const totalGmailResult = await db
      .select({ value: count() })
      .from(gmailAccounts);
    const totalGmailCount = totalGmailResult[0]?.value || 0;

    let templatesCount = 0;
    try {
      const ownersRow = await db
        .select()
        .from(settings)
        .where(eq(settings.key, "template_owners"))
        .limit(1);
      const owners: Record<string, number> = ownersRow.length
        ? JSON.parse(ownersRow[0].value || "{}")
        : {};
      const allTpls = await db.select({ id: templates.id }).from(templates);
      if (session) {
        if (isSuper) {
          templatesCount = allTpls.length;
        } else {
          templatesCount = allTpls.filter(
            (t) => owners[String(t.id)] === session.userId
          ).length;
        }
      } else {
        templatesCount = allTpls.length;
      }
    } catch {
      const r = await db.select({ value: count() }).from(templates);
      templatesCount = r[0]?.value || 0;
    }

    const campaignsResult = await db
      .select({ value: count() })
      .from(campaigns);
    const campaignsCount = campaignsResult[0]?.value || 0;

    const openRate =
      sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : 0;

    let recentQueueLogs: any[] = [];
    if (session && role === "operator" && operatorGmailIds.length > 0) {
      recentQueueLogs = await db
        .select()
        .from(queue)
        .where(
          or(
            inArray(queue.gmailUsedId, operatorGmailIds),
            eq(queue.status, "pending")
          )
        )
        .orderBy(desc(queue.createdAt))
        .limit(12);
    } else if (session && role === "operator") {
      recentQueueLogs = [];
    } else {
      recentQueueLogs = await db
        .select()
        .from(queue)
        .orderBy(desc(queue.createdAt))
        .limit(12);
    }

    let accountsList: any[] = [];
    if (session && role === "operator") {
      if (operatorGmailIds.length > 0) {
        accountsList = await db
          .select()
          .from(gmailAccounts)
          .where(inArray(gmailAccounts.id, operatorGmailIds))
          .orderBy(gmailAccounts.id);
      }
    } else {
      accountsList = await db
        .select()
        .from(gmailAccounts)
        .orderBy(gmailAccounts.id);
    }

    if (role === "operator") {
      accountsList = accountsList.map((a) => {
        const { appPassword, ...rest } = a;
        return rest;
      });
    }

    const recentOpensRaw = await db
      .select({
        id: trackingLogs.id,
        openedAt: trackingLogs.openedAt,
        ipAddress: trackingLogs.ipAddress,
        userAgent: trackingLogs.userAgent,
        browser: trackingLogs.browser,
        device: trackingLogs.device,
        trackingId: trackingLogs.trackingId,
        queueId: trackingLogs.queueId,
        logEmail: trackingLogs.email,
        logMarkName: trackingLogs.markName,
        logReferenceNo: trackingLogs.referenceNo,
        queueReferenceNo: queue.referenceNo,
        serialNo: queue.serialNo,
        queueMarkName: queue.markName,
        queueEmail: queue.email,
      })
      .from(trackingLogs)
      .leftJoin(queue, eq(trackingLogs.queueId, queue.id))
      .orderBy(desc(trackingLogs.openedAt))
      .limit(20);

    let recentOpens = recentOpensRaw.map((op) => {
      const isManual = op.queueId == null;
      return {
        id: op.id,
        openedAt: op.openedAt,
        ipAddress: op.ipAddress,
        userAgent: op.userAgent,
        browser: op.browser,
        device: op.device,
        trackingId: op.trackingId,
        queueId: op.queueId,
        source: isManual ? "manual" : "auto",
        referenceNo:
          op.queueReferenceNo ||
          op.logReferenceNo ||
          (isManual ? "MANUAL" : "—"),
        markName:
          op.queueMarkName ||
          op.logMarkName ||
          (isManual ? "Manual Send" : "—"),
        email: op.queueEmail || op.logEmail || "",
        serialNo: op.serialNo || "",
        gmailUsedId: null as number | null,
      };
    });

    // Operator: only opens for emails sent via their SMTP (best-effort)
    if (session && role === "operator" && operatorGmailIds.length > 0) {
      const mySent = await db
        .select({ email: queue.email, trackingId: queue.trackingId })
        .from(queue)
        .where(inArray(queue.gmailUsedId, operatorGmailIds));
      const myEmails = new Set(mySent.map((r) => (r.email || "").toLowerCase()));
      const myTrack = new Set(mySent.map((r) => r.trackingId));
      recentOpens = recentOpens.filter(
        (op) =>
          myTrack.has(op.trackingId) ||
          myEmails.has((op.email || "").toLowerCase())
      );
    }

    return NextResponse.json({
      success: true,
      stats: {
        totalEmails: totalCount,
        sent: sentCount,
        pending: pendingCount,
        sending: sendingCount,
        failed: failedCount,
        opened: openedCount,
        uniqueOpens,
        totalOpenEvents,
        openRate,
        activeGmailCount,
        totalGmailCount,
        templatesCount,
        campaignsCount,
        scope: role === "operator" ? "own" : "global",
      },
      accounts: accountsList,
      recentQueue: recentQueueLogs,
      recentOpens,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
