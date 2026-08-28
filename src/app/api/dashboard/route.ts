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
import { count, eq, desc, sql, inArray } from "drizzle-orm";
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

    const totalEmailsResult = await db.select({ value: count() }).from(queue);
    const totalCount = totalEmailsResult[0]?.value || 0;

    const sentEmailsResult = await db
      .select({ value: count() })
      .from(queue)
      .where(eq(queue.status, "sent"));
    const sentCount = sentEmailsResult[0]?.value || 0;

    const pendingEmailsResult = await db
      .select({ value: count() })
      .from(queue)
      .where(eq(queue.status, "pending"));
    const pendingCount = pendingEmailsResult[0]?.value || 0;

    const sendingEmailsResult = await db
      .select({ value: count() })
      .from(queue)
      .where(eq(queue.status, "sending"));
    const sendingCount = sendingEmailsResult[0]?.value || 0;

    const failedEmailsResult = await db
      .select({ value: count() })
      .from(queue)
      .where(eq(queue.status, "failed"));
    const failedCount = failedEmailsResult[0]?.value || 0;

    const openedResult = await db
      .select({ value: count() })
      .from(queue)
      .where(sql`${queue.openCount} > 0`);
    const openedCount = openedResult[0]?.value || 0;

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
    const role = normalizeRole(session.role, session.username);
    if (role === "super_admin") {
      templatesCount = allTpls.filter((t) => {
        const ownerId = owners[String(t.id)];
        return ownerId == null || ownerId === session.userId;
      }).length;
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

    const recentQueueLogs = await db
      .select()
      .from(queue)
      .orderBy(desc(queue.createdAt))
      .limit(12);

    // Accounts — operator ko sirf assigned
    let accountsList: any[] = [];
    const role = session
      ? normalizeRole(session.role, session.username)
      : "operator";

    if (session && role === "operator") {
      const assignments = await getSmtpAssignments();
      const allowedIds: number[] = (
        assignments[String(session.userId)] ||
        assignments[session.username] ||
        []
      )
        .map((id: any) => Number(id))
        .filter((id: number) => !isNaN(id) && id > 0);

      if (allowedIds.length > 0) {
        accountsList = await db
          .select()
          .from(gmailAccounts)
          .where(inArray(gmailAccounts.id, allowedIds))
          .orderBy(gmailAccounts.id);
      } else {
        accountsList = [];
      }
    } else {
      accountsList = await db
        .select()
        .from(gmailAccounts)
        .orderBy(gmailAccounts.id);
    }

    // appPassword operator se hide
    if (role === "operator") {
      accountsList = accountsList.map((a) => {
        const { appPassword, ...rest } = a;
        return rest;
      });
    }

    const recentOpens = await db
      .select({
        id: trackingLogs.id,
        openedAt: trackingLogs.openedAt,
        ipAddress: trackingLogs.ipAddress,
        userAgent: trackingLogs.userAgent,
        browser: trackingLogs.browser,
        device: trackingLogs.device,
        referenceNo: queue.referenceNo,
        serialNo: queue.serialNo,
        markName: queue.markName,
        email: queue.email,
      })
      .from(trackingLogs)
      .innerJoin(queue, eq(trackingLogs.queueId, queue.id))
      .orderBy(desc(trackingLogs.openedAt))
      .limit(10);

    return NextResponse.json({
      success: true,
      stats: {
        totalEmails: totalCount,
        sent: sentCount,
        pending: pendingCount,
        sending: sendingCount,
        failed: failedCount,
        opened: openedCount,
        openRate,
        activeGmailCount,
        totalGmailCount,
        templatesCount,
        campaignsCount,
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
