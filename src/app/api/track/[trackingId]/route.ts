import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { queue, trackingLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  recordOpenOnAutoSheet,
  recordOpenOnManualSheet,
} from "@/app/services/googleSheets";

// 1x1 transparent PNG base64
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

function pixelResponse() {
  return new NextResponse(TRANSPARENT_PNG, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function parseClient(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "Unknown Browser";
  const ipAddress =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  let browser = "Other";
  if (userAgent.includes("Firefox")) browser = "Firefox";
  else if (userAgent.includes("Chrome")) browser = "Chrome";
  else if (userAgent.includes("Safari")) browser = "Safari";
  else if (userAgent.includes("Edge")) browser = "Edge";
  else if (userAgent.includes("MSIE")) browser = "Internet Explorer";

  let device = "Desktop";
  if (
    userAgent.includes("Mobile") ||
    userAgent.includes("Android") ||
    userAgent.includes("iPhone")
  ) {
    device = "Mobile";
  }

  return { userAgent, ipAddress, browser, device };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ trackingId: string }> }
) {
  try {
    const { trackingId } = await context.params;
    if (!trackingId) return pixelResponse();

    const matchedQueue = await db
      .select()
      .from(queue)
      .where(eq(queue.trackingId, trackingId))
      .limit(1);

    const { userAgent, ipAddress, browser, device } = parseClient(request);
    const openedAt = new Date();
    const openedAtIso = openedAt.toISOString();

    if (matchedQueue.length > 0) {
      const qItem = matchedQueue[0];

      await db
        .update(queue)
        .set({
          openCount: qItem.openCount + 1,
          lastOpenedAt: openedAt,
        })
        .where(eq(queue.id, qItem.id));

      await db.insert(trackingLogs).values({
        queueId: qItem.id,
        trackingId,
        ipAddress,
        userAgent,
        browser,
        device,
        openedAt,
        email: qItem.email || null,
        markName: qItem.markName || null,
        referenceNo: qItem.referenceNo || null,
      });

      // Auto sheet Open Count / Opened At
      recordOpenOnAutoSheet(trackingId, openedAtIso).catch((err) =>
        console.error("auto sheet open update failed:", err)
      );
    } else {
      // Manual-send: update Google Sheet first so we can store email on the log
      let manualEmail: string | null = null;
      let manualMark: string | null = null;
      let manualRef: string | null = null;

      try {
        const sheetRes = await recordOpenOnManualSheet(trackingId, openedAtIso);
        if (sheetRes?.success) {
          manualEmail = (sheetRes as any).email || null;
          manualMark = (sheetRes as any).markName || null;
          manualRef = (sheetRes as any).referenceNo || null;
        }
      } catch (err) {
        console.error("manual sheet open update failed:", err);
      }

      await db.insert(trackingLogs).values({
        queueId: null,
        trackingId,
        ipAddress,
        userAgent,
        browser,
        device,
        openedAt,
        email: manualEmail,
        markName: manualMark || "Manual Send",
        referenceNo: manualRef || "MANUAL",
      });
    }

    console.log(
      `[TRACKING PIXEL] Logged email open for trackId: ${trackingId}, IP: ${ipAddress}`
    );
  } catch (error) {
    console.error("Error in open tracking route:", error);
  }

  return pixelResponse();
}
