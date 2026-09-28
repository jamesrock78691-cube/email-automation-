import { NextRequest, NextResponse } from "next/server";
import { db, pool, ensureSchemaReady, forceQueueWorkspaceColumn } from "@/db";
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

async function countQueue(ws: string, status?: string): Promise<number> {
  if (status) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n FROM queue WHERE workspace = $1 AND status = $2`,
      [ws, status]
    );
    return Number(r.rows[0]?.n || 0);
  }
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM queue WHERE workspace = $1`,
    [ws]
  );
  return Number(r.rows[0]?.n || 0);
}

export async function GET(req: NextRequest) {
  try {
    try {
      await ensureSchemaReady();
    } catch (e: any) {
      console.error("ensureSchemaReady:", e?.message || e);
    }
    await forceQueueWorkspaceColumn();

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
          ? JSON.parse(statsRows[0].value || "{}")
          : {};
        const my = statsMap[String(session.userId)] || {};
        sentCount = Number(my.totalSent) || 0;
      } catch {
        sentCount = 0;
      }

      if (operatorGmailIds.length > 0) {
        sentCount = await (async () => {
          const r = await pool.query(
            `SELECT COUNT(*)::int AS n FROM queue
             WHERE workspace = $1 AND status = 'sent' AND gmail_used_id = ANY($2::int[])`,
            [ws, operatorGmailIds]
          );
          const n = Number(r.rows[0]?.n || 0);
          return n > 0 ? n : sentCount;
        })();

        pendingCount = await countQueue(ws, "pending");
        sendingCount = await countQueue(ws, "sending");
        failedCount = await (async () => {
          const r = await pool.query(
            `SELECT COUNT(*)::int AS n FROM queue
             WHERE workspace = $1 AND status = 'failed' AND gmail_used_id = ANY($2::int[])`,
            [ws, operatorGmailIds]
          );
          return Number(r.rows[0]?.n || 0);
        })();
        totalCount = sentCount + pendingCount + sendingCount + failedCount;
      } else {
        totalCount = sentCount;
      }
    } else {
      totalCount = await countQueue(ws);
      sentCount = await countQueue(ws, "sent");
      pendingCount = await countQueue(ws, "pending");
      sendingCount = await countQueue(ws, "sending");
      failedCount = await countQueue(ws, "failed");

      try {
        await pool.query(
          `UPDATE tracking_logs tl
           SET workspace = q.workspace
           FROM queue q
           WHERE tl.tracking_id = q.tracking_id
             AND q.workspace = $1
             AND tl.workspace IS DISTINCT FROM q.workspace`,
          [ws]
        );
      } catch (e) {
        console.error("dashboard open workspace sync:", e);
      }

      try {
        const sumRow = await pool.query(
          `SELECT coalesce(sum(open_count), 0)::int AS n FROM queue WHERE workspace = $1`,
          [ws]
        );
        const sumOpens = Number(sumRow.rows[0]?.n || 0);
        const logCount = await pool.query(
          `SELECT COUNT(*)::int AS n FROM tracking_logs WHERE workspace = $1`,
          [ws]
        );
        const logsN = Number(logCount.rows[0]?.n || 0);
        totalOpenEvents = sumOpens > 0 ? sumOpens : logsN;
      } catch (e) {
        console.error("dashboard totalOpenEvents:", e);
        totalOpenEvents = 0;
      }

      try {
        const qOpened = await pool.query(
          `SELECT COUNT(*)::int AS n FROM queue
           WHERE workspace = $1 AND coalesce(open_count, 0) > 0`,
          [ws]
        );
        const fromQueue = Number(qOpened.rows[0]?.n || 0);
        const logUniq = await pool.query(
          `SELECT COUNT(DISTINCT coalesce(nullif(trim(email), ''), tracking_id))::int AS n
           FROM tracking_logs WHERE workspace = $1`,
          [ws]
        );
        const fromLogs = Number(logUniq.rows[0]?.n || 0);
        uniqueOpens = Math.max(fromQueue, fromLogs);
        openedCount = uniqueOpens;
      } catch (e) {
        console.error("dashboard uniqueOpens:", e);
        uniqueOpens = 0;
        openedCount = 0;
      }
    }

    let activeGmailCount = 0;
    let totalGmailCount = 0;
    try {
      const a = await pool.query(
        `SELECT COUNT(*)::int AS n FROM gmail_accounts WHERE workspace = $1 AND status = 'enabled'`,
        [ws]
      );
      activeGmailCount = Number(a.rows[0]?.n || 0);
      const t = await pool.query(
        `SELECT COUNT(*)::int AS n FROM gmail_accounts WHERE workspace = $1`,
        [ws]
      );
      totalGmailCount = Number(t.rows[0]?.n || 0);
    } catch (e) {
      console.error("gmail counts:", e);
    }

    let templatesCount = 0;
    try {
      const tRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM templates WHERE workspace = $1`,
        [ws]
      );
      templatesCount = Number(tRes.rows[0]?.n || 0);
    } catch {
      templatesCount = 0;
    }

    let campaignsCount = 0;
    try {
      const cRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM campaigns WHERE workspace = $1`,
        [ws]
      );
      campaignsCount = Number(cRes.rows[0]?.n || 0);
    } catch {
      campaignsCount = 0;
    }

    const openRate =
      sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : 0;

    let recentQueueLogs: any[] = [];
    try {
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
        const rq = await pool.query(
          `SELECT * FROM queue WHERE workspace = $1 ORDER BY id DESC LIMIT 50`,
          [ws]
        );
        recentQueueLogs = rq.rows;
      }
    } catch (e) {
      console.error("recentQueue:", e);
      recentQueueLogs = [];
    }

    let accountsList: any[] = [];
    try {
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
        const ac = await pool.query(
          `SELECT * FROM gmail_accounts WHERE workspace = $1`,
          [ws]
        );
        accountsList = ac.rows;
      }
    } catch (e) {
      console.error("accounts:", e);
    }

    let recentOpens: any[] = [];
    try {
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

      recentOpens = recentOpensRaw.map((op) => {
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
    } catch (e) {
      console.error("recentOpens:", e);
      recentOpens = [];
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
    console.error("dashboard GET:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Server error",
        detail: error?.cause?.message || error?.code || undefined,
      },
      { status: 500 }
    );
  }
}
