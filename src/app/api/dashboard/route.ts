import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { queue, gmailAccounts, templates, campaigns, trackingLogs } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { count, eq, desc, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    // Run auto seeder if tables are empty
    await seedDatabase();

    // Fetch counts
    const totalEmailsResult = await db.select({ value: count() }).from(queue);
    const totalCount = totalEmailsResult[0]?.value || 0;

    const sentEmailsResult = await db.select({ value: count() }).from(queue).where(eq(queue.status, "sent"));
    const sentCount = sentEmailsResult[0]?.value || 0;

    const pendingEmailsResult = await db.select({ value: count() }).from(queue).where(eq(queue.status, "pending"));
    const pendingCount = pendingEmailsResult[0]?.value || 0;

    const sendingEmailsResult = await db.select({ value: count() }).from(queue).where(eq(queue.status, "sending"));
    const sendingCount = sendingEmailsResult[0]?.value || 0;

    const failedEmailsResult = await db.select({ value: count() }).from(queue).where(eq(queue.status, "failed"));
    const failedCount = failedEmailsResult[0]?.value || 0;

    // Opened count (emails where openCount > 0)
    const openedResult = await db.select({ value: count() }).from(queue).where(sql`${queue.openCount} > 0`);
    const openedCount = openedResult[0]?.value || 0;

    // Gmail rotators count
    const activeGmailResult = await db.select({ value: count() }).from(gmailAccounts).where(eq(gmailAccounts.status, "enabled"));
    const activeGmailCount = activeGmailResult[0]?.value || 0;

    const totalGmailResult = await db.select({ value: count() }).from(gmailAccounts);
    const totalGmailCount = totalGmailResult[0]?.value || 0;

    // Fetch templates count
    const templatesResult = await db.select({ value: count() }).from(templates);
    const templatesCount = templatesResult[0]?.value || 0;

    // Fetch campaigns count
    const campaignsResult = await db.select({ value: count() }).from(campaigns);
    const campaignsCount = campaignsResult[0]?.value || 0;

    // Calculate open rate
    const openRate = sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : 0;

    // Fetch recent activity queue logs
    const recentQueueLogs = await db
      .select()
      .from(queue)
      .orderBy(desc(queue.createdAt))
      .limit(12);

    // Fetch list of accounts
    const accountsList = await db.select().from(gmailAccounts).orderBy(gmailAccounts.id);

    // Fetch recent tracker opens
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
        openRate: `${openRate}%`,
        activeGmailCount,
        totalGmailCount,
        templatesCount,
        campaignsCount,
      },
      accounts: accountsList,
      recentQueue: recentQueueLogs,
      recentOpens: recentOpens,
    });
  } catch (error: any) {
    console.error("Dashboard calculation error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// Simple raw sql helper fallback
