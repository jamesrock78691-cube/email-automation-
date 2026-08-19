import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { queue, templates, campaigns } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { processNextQueueItem } from "@/app/services/emailSender";
import { importPendingRowsToQueue } from "@/app/services/googleSheets";

export async function GET(request: NextRequest) {
  try {
    const list = await db.select().from(queue).orderBy(desc(queue.createdAt));
    return NextResponse.json({ success: true, list });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, items, campaignId } = body;

    const host = request.headers.get("host") || "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const baseUrl = `${protocol}://${host}`;

    if (action === "process_next") {
      const result = await processNextQueueItem(baseUrl);
      return NextResponse.json({ success: true, result });
    }

    if (action === "process_batch") {
      const results = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < 10; i++) {
        const res = await processNextQueueItem(baseUrl);
        if (!res.success && res.error?.includes("No pending emails")) {
          break;
        }
        results.push(res);
        if (res.success) successCount++;
        else failCount++;
      }

      return NextResponse.json({
        success: true,
        summary: `Processed ${results.length} items. Sent: ${successCount}, Failed: ${failCount}.`,
        results,
      });
    }

    /**
     * Import sheet rows into queue.
     * If campaignId is set → use that campaign's templateId for every row.
     */
    if (action === "import") {
      if (items && Array.isArray(items) && items.length > 0) {
        let campaignTemplateId: number | null = null;
        let campaignSubject: string | null = null;
        const cid = campaignId ? Number(campaignId) : null;

        if (cid) {
          const camps = await db
            .select()
            .from(campaigns)
            .where(eq(campaigns.id, cid))
            .limit(1);

          if (camps.length && camps[0].templateId) {
            campaignTemplateId = camps[0].templateId;
            const tpls = await db
              .select()
              .from(templates)
              .where(eq(templates.id, campaignTemplateId))
              .limit(1);
            if (tpls.length) {
              campaignSubject = tpls[0].subject || null;
            }
          }
        }

        const rows = items
          .filter((it: any) => it.email)
          .map((it: any) => {
            const rowTemplateId = it.templateId
              ? Number(it.templateId)
              : campaignTemplateId;

            return {
              campaignId: cid,
              referenceNo: String(it.referenceNo || ""),
              serialNo: String(it.serialNo || ""),
              markName: String(it.markName || ""),
              filingDate: String(it.filingDate || ""),
              email: String(it.email || ""),
              cc: it.cc ? String(it.cc) : null,
              bcc: it.bcc ? String(it.bcc) : null,
              subject: String(
                it.subject || campaignSubject || "Trademark Notice"
              ),
              templateId: rowTemplateId,
              trackingId: randomUUID(),
              status: "pending" as const,
              tries: 0,
              maxTries: 3,
            };
          });

        if (!rows.length) {
          return NextResponse.json(
            {
              success: false,
              error: "No valid rows (need Email column)",
            },
            { status: 400 }
          );
        }

        await db.insert(queue).values(rows);

        return NextResponse.json({
          success: true,
          count: rows.length,
          campaignId: cid,
          templateId: campaignTemplateId,
          message: campaignTemplateId
            ? `Imported ${rows.length} rows with campaign template #${campaignTemplateId}`
            : `Imported ${rows.length} rows (no campaign template linked)`,
        });
      }

      // Fallback: Google Sheets service import
      const result = await importPendingRowsToQueue();
      return NextResponse.json(result);
    }

    if (action === "reset_all") {
      await db
        .update(queue)
        .set({
          status: "pending",
          tries: 0,
          errorMessage: null,
          gmailUsedId: null,
          gmailUsedEmail: null,
          sentAt: null,
        })
        .where(eq(queue.status, "failed"));

      return NextResponse.json({
        success: true,
        message: "Only failed emails have been reset to pending status.",
      });
    }

    if (action === "clear_all") {
      await db.delete(queue);
      return NextResponse.json({
        success: true,
        message: "Queue database tables cleared successfully.",
      });
    }

    return NextResponse.json(
      { success: false, error: "Invalid queue control action specified." },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("Queue control route error:", error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
