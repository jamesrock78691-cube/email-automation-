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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, items, campaignId, templateId } = body;

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
        if (!res.success && res.error?.includes("No pending emails")) break;
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

    if (action === "import") {
      if (items && Array.isArray(items) && items.length > 0) {
        const allTemplates = await db
          .select({ id: templates.id, subject: templates.subject })
          .from(templates);
        const validTemplateIds = new Set(allTemplates.map((t) => t.id));
        const firstTemplate = allTemplates[0] || null;
        const forcedTemplateId =
  templateId != null && templateId !== ""
    ? Number(templateId)
    : null;

        let validCampaignId: number | null = null;
        let campaignTemplateId: number | null = null;
        let campaignSubject: string | null = null;

        const cid = campaignId != null && campaignId !== "" ? Number(campaignId) : null;
        if (cid && !Number.isNaN(cid)) {
          const camps = await db.select().from(campaigns).where(eq(campaigns.id, cid)).limit(1);
          if (camps.length > 0) {
            validCampaignId = camps[0].id;
            if (camps[0].templateId && validTemplateIds.has(camps[0].templateId)) {
              campaignTemplateId = camps[0].templateId;
              const tpl = allTemplates.find((t) => t.id === campaignTemplateId);
              campaignSubject = tpl?.subject || null;
            }
          }
        }

        const fallbackTemplateId =
  (forcedTemplateId && validTemplateIds.has(forcedTemplateId)
    ? forcedTemplateId
    : null) ??
  campaignTemplateId ??
  (firstTemplate ? firstTemplate.id : null);

        const rows = items
          .filter((it: any) => it?.email && String(it.email).trim())
          .map((it: any) => {
            let rowTemplateId: number | null = null;
            if (it.templateId != null && it.templateId !== "") {
              const tid = Number(it.templateId);
              if (!Number.isNaN(tid) && validTemplateIds.has(tid)) rowTemplateId = tid;
            }
            if (rowTemplateId == null) rowTemplateId = fallbackTemplateId;

            return {
              campaignId: validCampaignId,
              referenceNo: String(it.referenceNo ?? it.reference_no ?? ""),
              serialNo: String(it.serialNo ?? it.serial_no ?? ""),
              markName: String(it.markName ?? it.mark_name ?? ""),
              filingDate: String(it.filingDate ?? it.filing_date ?? ""),
              email: String(it.email).trim(),
              cc: it.cc ? String(it.cc) : null,
              bcc: it.bcc ? String(it.bcc) : null,
              subject: String(
                it.subject || campaignSubject || firstTemplate?.subject || "Trademark Notice"
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
            { success: false, error: "No valid rows (Email column required)" },
            { status: 400 }
          );
        }

        try {
          await db.insert(queue).values(rows);
        } catch (insertErr: any) {
          const msg =
            insertErr?.cause?.message || insertErr?.message || "Failed to insert into queue";
          return NextResponse.json({ success: false, error: msg }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          count: rows.length,
          campaignId: validCampaignId,
          templateId: fallbackTemplateId,
          message: `Imported ${rows.length} rows using campaign template #${fallbackTemplateId ?? "N/A"}`,
        });
      }

      try {
        const forcedId =
  templateId != null && templateId !== ""
    ? Number(templateId)
    : null;
const result = await importPendingRowsToQueue(
  forcedId && !Number.isNaN(forcedId) ? forcedId : null
);
        return NextResponse.json(result);
      } catch (sheetErr: any) {
        return NextResponse.json(
          { success: false, error: sheetErr?.message || "Sheets import failed" },
          { status: 500 }
        );
      }
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
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
