import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  queue,
  gmailAccounts,
  templates,
  campaigns,
  trackingLogs,
  settings,
} from "@/db/schema";
import { count, eq, desc, sql, inArray, and, or } from "drizzle-orm";
import { workspaceSql, settingKey } from "@/lib/workspace";
import {
  getSessionFromRequest,
  normalizeRole,
} from "@/lib/authSession";

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }
    const role = normalizeRole(session.role, session.username);
    const ws = session.workspace;

    let operatorGmailIds: number[] = [];
    if (session && role === "operator") {
      try {
        const row = await db
          .select()
          .from(settings)
          .where(eq(settings.key, settingKey("smtp_assignments", ws)))
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
          .where(eq(settings.key, settingKey("agent_stats", ws)))
          .limit(1);
        const statsMap = statsRows.length
          ? JSON.parse(statsRows[0].value || "{}") : {};
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
            and(
              eq(queue.status, "sent"),
              inArray(queue.gmailUsedId, operatorGmailIds),
              workspaceSql(queue.workspace, ws)
            )
          );
        const viaN = sentVia[0]?.value || 0;
        if (viaN > 0) sentCount = viaN;

        const mySent = await db
          .select({ trackingId: queue.trackingId, email: queue.email })
          .from(queue)
          .where(
            and(
              inArray(queue.gmailUsedId, operatorGmailIds),
              workspaceSql(queue.workspace, ws)
            )
          );
        const myTrackIds = mySent
          .map((r) => r.trackingId)
          .filter(Boolean) as string[];

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
        }

        const failedVia = await db
          .select({ value: count() })
          .from(queue)
          .where(
            and(
              eq(queue.status, "failed"),
              inArray(queue.gmailUsedId, operatorGmailIds),
              workspaceSql(queue.workspace, ws)
            )
          );
        failedCount = failedVia[0]?.value || 0;

        const pendingEmailsResult = await db
          .select({ value: count() })
          .from(queue)
          .where(
            and(
              eq(queue.status, "pending"),
              workspaceSql(queue.workspace, ws)
            )
          );
        pendingCount = pendingEmailsResult[0]?.value || 0;

        const sendingEmailsResult = await db
          .select({ value: count() })
          .from(queue)
          .where(
            and(
              eq(queue.status, "sending"),
              workspaceSql(queue.workspace, ws)
            )
          );
        sendingCount = sendingEmailsResult[0]?.value || 0;

        totalCount = sentCount + pendingCount + sendingCount + failedCount;
      } else {
        totalCount = sentCount;
      }
    } else {
      const totalEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(workspaceSql(queue.workspace, ws));
      totalCount = totalEmailsResult[0]?.value || 0;

      const sentEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(
          and(eq(queue.status, "sent"), workspaceSql(queue.workspace, ws))
        );
      sentCount = sentEmailsResult[0]?.value || 0;

      const pendingEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(
          and(
            eq(queue.status, "pending"),
            workspaceSql(queue.workspace, ws)
          )
        );
      pendingCount = pendingEmailsResult[0]?.value || 0;

      const sendingEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(
          and(
            eq(queue.status, "sending"),
            workspaceSql(queue.workspace, ws)
          )
        );
      sendingCount = sendingEmailsResult[0]?.value || 0;

      const failedEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(
          and(
            eq(queue.status, "failed"),
            workspaceSql(queue.workspace, ws)
          )
        );
      failedCount = failedEmailsResult[0]?.value || 0;

      try {
        await db.execute(sql`
          UPDATE tracking_logs tl
          SET workspace = q.workspace
          FROM queue q
          WHERE tl.tracking_id = q.tracking_id
            AND q.workspace = ${ws}
            AND tl.workspace IS DISTINCT FROM q.workspace
        `);
      } catch (e) {
        console.error("dashboard open workspace sync:", e);
      }

      const totalEvents = await db.execute(sql`
        SELECT COUNT(*)::int AS value FROM (
          SELECT tl.id FROM tracking_logs tl
          WHERE tl.workspace = ${ws}
          UNION
          SELECT tl.id FROM tracking_logs tl
          INNER JOIN queue q ON q.tracking_id = tl.tracking_id
          WHERE q.workspace = ${ws}
        ) x
      `);
      totalOpenEvents = Number(
        (totalEvents as any)?.rows?.[0]?.value ??
          (totalEvents as any)?.[0]?.value ??
          0
      );

      const uniqueAll = await db.execute(sql`
        SELECT COUNT(*)::int AS value FROM (
          SELECT DISTINCT COALESCE(NULLIF(TRIM(tl.email), ''), tl.tracking_id) AS k
          FROM tracking_logs tl
          WHERE tl.workspace = ${ws}
          UNION
          SELECT DISTINCT COALESCE(NULLIF(TRIM(tl.email), ''), tl.tracking_id)
          FROM tracking_logs tl
          INNER JOIN queue q ON q.tracking_id = tl.tracking_id
          WHERE q.workspace = ${ws}
          UNION
          SELECT DISTINCT COALESCE(NULLIF(TRIM(q.email), ''), q.tracking_id)
          FROM queue q
          WHERE q.workspace = ${ws}
            AND COALESCE(q.open_count, 0) > 0
        ) u
      `);
      uniqueOpens = Number(
        (uniqueAll as any)?.rows?.[0]?.value ??
          (uniqueAll as any)?.[0]?.value ??
          0
      );
      openedCount = uniqueOpens;
    }

    const activeGmailResult = await db
      .select({ value: count() })
      .from(gmailAccounts)
      .where(
        and(
          eq(gmailAccounts.status, "enabled"),
          workspaceSql(gmailAccounts.workspace, ws)
        )
      );
    const activeGmailCount = activeGmailResult[0]?.value || 0;

    const totalGmailResult = await db
      .select({ value: count() })
      .from(gmailAccounts)
      .where(workspaceSql(gmailAccounts.workspace, ws));
    const totalGmailCount = totalGmailResult[0]?.value || 0;

    let templatesCount = 0;
    try {
      const tRes = await db
        .select({ value: count() })
        .from(templates)
        .where(workspaceSql(templates.workspace, ws));
      templatesCount = tRes[0]?.value || 0;
    } catch {
      templatesCount = 0;
    }

    const campaignsResult = await db
      .select({ value: count() })
      .from(campaigns)
      .where(workspaceSql(campaigns.workspace, ws));
    const campaignsCount = campaignsResult[0]?.value || 0;

    const openRate =
      sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : 0;

    let recentQueueLogs: any[] = [];
    if (session && role === "operator" && operatorGmailIds.length > 0) {
      recentQueueLogs = await db
        .select()
        .from(queue)
        .where(
          and(
            inArray(queue.gmailUsedId, operatorGmailIds),
            workspaceSql(queue.workspace, ws)
          )
        )
        .orderBy(desc(queue.id))
        .limit(50);
    } else {
      recentQueueLogs = await db
        .select()
        .from(queue)
        .where(workspaceSql(queue.workspace, ws))
        .orderBy(desc(queue.id))
        .limit(50);
    }

    let accountsList: any[] = [];
    if (session && role === "operator" && operatorGmailIds.length > 0) {
      accountsList = await db
        .select()
        .from(gmailAccounts)
        .where(
          and(
            inArray(gmailAccounts.id, operatorGmailIds),
            workspaceSql(gmailAccounts.workspace, ws)
          )
        );
    } else if (role !== "operator") {
      accountsList = await db
        .select()
        .from(gmailAccounts)
        .where(workspaceSql(gmailAccounts.workspace, ws));
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
      .leftJoin(
        queue,
        or(
          eq(trackingLogs.queueId, queue.id),
          eq(trackingLogs.trackingId, queue.trackingId)
        )
      )
      .where(
        or(
          workspaceSql(trackingLogs.workspace, ws),
          workspaceSql(queue.workspace, ws)
        )
      )
      .orderBy(desc(trackingLogs.openedAt))
      .limit(40);

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

    if (session && role === "operator" && operatorGmailIds.length > 0) {
      const mySent = await db
        .select({ email: queue.email, trackingId: queue.trackingId })
        .from(queue)
        .where(
          and(
            inArray(queue.gmailUsedId, operatorGmailIds),
            workspaceSql(queue.workspace, ws)
          )
        );
      const myEmails = new Set(
        mySent.map((r) => (r.email || "").toLowerCase())
      );
      const myTracks = new Set(
        mySent.map((r) => r.trackingId).filter(Boolean)
      );
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
        workspace: ws,
      },
      accounts: accountsList,
      recentQueue: recentQueueLogs,
      recentOpens,
      workspace: ws,
      user: session.username,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
