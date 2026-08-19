import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { queue, trackingLogs } from "@/db/schema";
import { eq } from "drizzle-orm";

// 1x1 transparent PNG base64
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ trackingId: string }> }
) {
  try {
    const { trackingId } = await context.params;
    if (!trackingId) {
      return new NextResponse(TRANSPARENT_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    }

    // 1. Find corresponding queue item
    const matchedQueue = await db
      .select()
      .from(queue)
      .where(eq(queue.trackingId, trackingId))
      .limit(1);

    if (matchedQueue.length > 0) {
      const qItem = matchedQueue[0];

      // 2. Increment open counts
      await db
        .update(queue)
        .set({
          openCount: qItem.openCount + 1,
          lastOpenedAt: new Date(),
        })
        .where(eq(queue.id, qItem.id));

      // 3. Log user tracking metadata
      const userAgent = request.headers.get("user-agent") || "Unknown Browser";
      const ipAddress = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "127.0.0.1";
      
      // Basic browser/device extractor
      let browser = "Other";
      if (userAgent.includes("Firefox")) browser = "Firefox";
      else if (userAgent.includes("Chrome")) browser = "Chrome";
      else if (userAgent.includes("Safari")) browser = "Safari";
      else if (userAgent.includes("Edge")) browser = "Edge";
      else if (userAgent.includes("MSIE")) browser = "Internet Explorer";

      let device = "Desktop";
      if (userAgent.includes("Mobile") || userAgent.includes("Android") || userAgent.includes("iPhone")) {
        device = "Mobile";
      }

      await db.insert(trackingLogs).values({
        queueId: qItem.id,
        trackingId: trackingId,
        ipAddress: ipAddress,
        userAgent: userAgent,
        browser: browser,
        device: device,
        openedAt: new Date(),
      });

      console.log(`[TRACKING PIXEL] Logged email open for trackId: ${trackingId}, IP: ${ipAddress}`);
    }
  } catch (error) {
    console.error("Error in open tracking route:", error);
  }

  // Always return the pixel image, never fail so the email looks perfect!
  return new NextResponse(TRANSPARENT_PNG, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}
