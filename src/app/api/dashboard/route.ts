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
import { count, eq, desc, sql, inArray, and } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { workspaceFromRequest, workspaceSql, settingKey, resolveWorkspace } from "@/lib/workspace";

const SECRET: string =
  process.env.AUTH_SECRET ||
  process.env.JWT_SECRET ||
  "email-automation-secret-key-change-me";

function sign(payloadB64: string) {
  return createHmac("sha256", SECRET).update(payloadB64).digest("hex");
}

function verifyToken(token: string): {
  userId: number;
  username: string;
  role: string;
  exp: number;
} | null {
  try {
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const expected = sign(payloadB64);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const data = JSON.parse(json);
    if (!data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function getSession(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearer =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
  const cookie = req.cookies.get("ea_session")?.value;
  const token = bearer || cookie;
  if (!token) return null;
  return verifyToken(token);
}

function normalizeRole(role: string, username?: string) {
  const r = (role || "").toLowerCase().replace(/-/g, "_");
  if (r === "super_admin" || r === "superadmin") return "super_admin";
  if (r === "admin") return "admin";
  if (username === "admin" || username === "superadmin") return "super_admin";
  return "operator";
}

export async function GET(req: NextRequest) {
  try {
    const session = getSession(req);
    const role = session
      ? normalizeRole(session.role, session.username)
      : "guest";
    const ws = session
      ? resolveWorkspace(session.username, (session as any).workspace)
      : "main";

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
          .where(and(inArray(queue.gmailUsedId, operatorGmailIds), workspaceSql(queue.workspace, ws)));
        const myTrackIds = mySent.map((r) => r.trackingId).filter(Boolean) as string[];

        if (myTrackIds.length > 0) {
          const openEvents = await db
            .select({ value: count() })
            .from(trackingLogs)
            .where(and(inArray(trackingLogs.trackingId, myTrackIds), workspaceSql(trackingLogs.workspace, ws)));
          totalOpenEvents = openEvents[0]?.value || 0;

          const uniq = await db
            .select({
              value: sql<number>`count(distinct coalesce(${trackingLogs.email}, ${trackingLogs.trackingId}))`,
            })
            .from(trackingLogs)
            .where(and(inArray(trackingLogs.trackingId, myTrackIds), workspaceSql(trackingLogs.workspace, ws)));
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
          .where(and(eq(queue.status, "pending"), workspaceSql(queue.workspace, ws)));
        pendingCount = pendingEmailsResult[0]?.value || 0;

        const sendingEmailsResult = await db
          .select({ value: count() })
          .from(queue)
          .where(and(eq(queue.status, "sending"), workspaceSql(queue.workspace, ws)));
        sendingCount = sendingEmailsResult[0]?.value || 0;

        totalCount = sentCount + pendingCount + sendingCount + failedCount;
      } else {
        totalCount = sentCount;
      }
    } else {
      const totalEmailsResult = await db.select({ value: count() }).from(queue).where(workspaceSql(queue.workspace, ws));
      totalCount = totalEmailsResult[0]?.value || 0;

      const sentEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(and(eq(queue.status, "sent"), workspaceSql(queue.workspace, ws)));
      sentCount = sentEmailsResult[0]?.value || 0;

      const pendingEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(and(eq(queue.status, "pending"), workspaceSql(queue.workspace, ws)));
      pendingCount = pendingEmailsResult[0]?.value || 0;

      const sendingEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(and(eq(queue.status, "sending"), workspaceSql(queue.workspace, ws)));
      sendingCount = sendingEmailsResult[0]?.value || 0;

      const failedEmailsResult = await db
        .select({ value: count() })
        .from(queue)
        .where(and(eq(queue.status, "failed"), workspaceSql(queue.workspace, ws)));
      failedCount = failedEmailsResult[0]?.value || 0;

      const totalEvents = await db
        .select({ value: count() })
        .from(trackingLogs)
        .where(workspaceSql(trackingLogs.workspace, ws));
      totalOpenEvents = totalEvents[0]?.value || 0;

      const uniqueAll = await db
        .select({
          value: sql<number>`count(distinct coalesce(${trackingLogs.email}, ${trackingLogs.trackingId}))`,
        })
        .from(trackingLogs)
        .where(workspaceSql(trackingLogs.workspace, ws));
      uniqueOpens = Number(uniqueAll[0]?.value || 0);
      openedCount = uniqueOpens;
    }

    const activeGmailResult = await db
      .select({ value: count() })
      .from(gmailAccounts)
      .where(and(eq(gmailAccounts.status, "enabled"), workspaceSql(gmailAccounts.workspace, ws)));
    const activeGmailCount = activeGmailResult[0]?.value || 0;

    const totalGmailResult = await db
      .select({ value: count() })
      .from(gmailAccounts)
      .where(workspaceSql(gmailAccounts.workspace, ws));
    const totalGmailCount = totalGmailResult[0]?.value || 0;

    let templatesCount = 0;
    try {
      const tRes = await db.select({ value: count() }).from(templates).where(workspaceSql(templates.workspace, ws));
      templatesCount = tRes[0]?.value || 0;
    } catch {
      templatesCount = 0;
    }

    const campaignsResult = await db.select({ value: count() }).from(campaigns).where(workspaceSql(campaigns.workspace, ws));
    const campaignsCount = campaignsResult[0]?.value || 0;

    const openRate =
      sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : 0;

    let recentQueueLogs: any[] = [];
    if (session && role === "operator" && operatorGmailIds.length > 0) {
      recentQueueLogs = await db
        .select()
        .from(queue)
        .where(and(inArray(queue.gmailUsedId, operatorGmailIds), workspaceSql(queue.workspace, ws)))
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
        .where(and(inArray(gmailAccounts.id, operatorGmailIds), workspaceSql(gmailAccounts.workspace, ws)));
    } else if (role !== "operator") {
      accountsList = await db.select().from(gmailAccounts).where(workspaceSql(gmailAccounts.workspace, ws));
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
      .where(workspaceSql(trackingLogs.workspace, ws))
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

    if (session && role === "operator" && operatorGmailIds.length > 0) {
      const mySent = await db
        .select({ email: queue.email, trackingId: queue.trackingId })
        .from(queue)
        .where(and(inArray(queue.gmailUsedId, operatorGmailIds), workspaceSql(queue.workspace, ws)));
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
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
