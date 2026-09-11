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
import { count, eq, desc, sql, inArray, and, or } from "drizzle-orm";
import { jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "email-automation-secret-key-change-me"
);

async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      userId: payload.userId as number,
      username: (payload.username as string) || "",
      role: (payload.role as string) || "operator",
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
  const r = (role || "").toLowerCase();
  if (r === "super_admin" || r === "superadmin") return "super_admin";
  if (r === "admin") return "admin";
  if (username === "admin" || username === "superadmin") return "super_admin";
  return "operator";
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    const role = session
      ? normalizeRole(session.role, session.username)
      : "guest";

    // Operator SMTP assignment map
    let operatorGmailIds: number[] = [];
    if (session && role === "operator") {
      try {
        const row = await db
          .select()
          .from(settings)
          .where(eq(settings.key, "smtp_assignments"))
          .limit(1);
        const map = row.length ? JSON.parse(row[0].value || "{}") : {};
        const ids = map[String(session.userId)] || map[session.username] || [];
        operatorGmailIds = (Array.isArray(ids) ? ids : [])
          .map((id: any) => Number(id))
          .filter((id: number) => !isNaN(id) && id > 0);
      } catch {
        operatorGmailIds = [];
      }
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

        // Opens from tracking_logs (source of truth) scoped to operator's sent emails
        const mySent = await db
          .select({ trackingId: queue.trackingId, email: queue.email })
          .from(queue)
          .where(inArray(queue.gmailUsedId, operatorGmailIds));
        const myTrackIds = mySent.map((r) => r.trackingId).filter(Boolean);
        const myEmails = new Set(
          mySent.map((r) => (r.email || "").toLowerCase()).filter(Boolean)
        );

        if (myTrackIds.length > 0) {
          const openEvents = await db
            .select({ value: count() })
            .from(trackingLogs)
            .where(inArray(trackingLogs.trackingId, myTrackIds));
          totalOpenEvents = openEvents[0]?.value || 0;

          const uniq = await db
            .select({
              value: sql<number>`count(distinct coalesce(${trackingLogs.email}, ${trackingLogs.trackingId}))`,
            })
            .from(trackingLogs)
            .where(inArray(trackingLogs.trackingId, myTrackIds));
          uniqueOpens = Number(uniq[0]?.value || 0);
          openedCount = uniqueOpens;
        } else {
          // Fallback: match by email on tracking logs
          const allLogs = await db
            .select({
              email: trackingLogs.email,
              trackingId: trackingLogs.trackingId,
            })
            .from(trackingLogs)
            .orderBy(desc(trackingLogs.openedAt))
            .limit(500);
          const mine = allLogs.filter(
            (l) => l.email && myEmails.has(String(l.email).toLowerCase())
          );
          totalOpenEvents = mine.length;
          uniqueOpens = new Set(
            mine.map((l) => (l.email || l.trackingId || "").toLowerCase())
          ).size;
          openedCount = uniqueOpens;
        }

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

      // Source of truth: tracking_logs (matches Live Tracking Pixel Opens section)
      const totalEvents = await db
        .select({ value: count() })
        .from(trackingLogs);
      totalOpenEvents = totalEvents[0]?.value || 0;

      const uniqueAll = await db
        .select({
          value: sql<number>`count(distinct coalesce(${trackingLogs.email}, ${trackingLogs.trackingId}))`,
        })
        .from(trackingLogs);
      uniqueOpens = Number(uniqueAll[0]?.value || 0);

      // Card "opened" = unique recipients who opened (same as Unique Opens card)
      openedCount = uniqueOpens;
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
      if (session && role === "operator") {
        const tRes = await db.select({ value: count() }).from(templates);
        templatesCount = tRes[0]?.value || 0;
      } else {
        const tRes = await db.select({ value: count() }).from(templates);
        templatesCount = tRes[0]?.value || 0;
      }
    } catch {
      const tRes = await db.select({ value: count() }).from(templates);
      templatesCount = tRes[0]?.value || 0;
    }

    const campaignsResult = await db.select({ value: count() }).from(campaigns);
    const campaignsCount = campaignsResult[0]?.value || 0;

    const openRate =
      sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : 0;

    let recentQueueLogs: any[] = [];
    if (session && role === "operator" && operatorGmailIds.length > 0) {
      recentQueueLogs = await db
        .select()
        .from(queue)
        .where(inArray(queue.gmailUsedId, operatorGmailIds))
        .orderBy(desc(queue.id))
        .limit(50);
    } else {
      recentQueueLogs = await db
        .select()
        .from(queue)
        .orderBy(desc(queue.id))
        .limit(50);
    }

    let accountsList: any[] = [];
    if (session && role === "operator" && operatorGmailIds.length > 0) {
      accountsList = await db
        .select()
        .from(gmailAccounts)
        .where(inArray(gmailAccounts.id, operatorGmailIds));
    } else if (role !== "operator") {
      accountsList = await db.select().from(gmailAccounts);
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
      const myTracks = new Set(mySent.map((r) => r.trackingId).filter(Boolean));
      recentOpens = recentOpens.filter(
        (op) =>
          (op.email && myEmails.has(op.email.toLowerCase())) ||
          (op.trackingId && myTracks.has(op.trackingId))
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
