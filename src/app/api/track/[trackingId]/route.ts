import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { queue, trackingLogs, settings } from "@/db/schema";
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

const MANUAL_MAP_KEY = "manual_track_map";

function pixelResponse() {
  return new NextResponse(TRANSPARENT_PNG, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(TRANSPARENT_PNG.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function parseClient(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "Unknown Browser";
  const ipAddress =
    (request.headers.get("x-forwarded-for") || "")
      .split(",")[0]
      .trim() ||
    request.headers.get("x-real-ip") ||
    "127.0.0.1";

  let browser = "Other";
  if (userAgent.includes("Firefox")) browser = "Firefox";
  else if (userAgent.includes("Edg")) browser = "Edge";
  else if (userAgent.includes("Chrome")) browser = "Chrome";
  else if (userAgent.includes("Safari")) browser = "Safari";
  else if (userAgent.includes("MSIE") || userAgent.includes("Trident"))
    browser = "Internet Explorer";

  let device = "Desktop";
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(userAgent)) {
    device = "Mobile";
  }

  return { userAgent, ipAddress, browser, device };
}

async function lookupManualMap(trackingId: string): Promise<{
  email?: string;
  markName?: string;
  referenceNo?: string;
  subject?: string;
} | null> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, MANUAL_MAP_KEY))
      .limit(1);
    if (!rows.length) return null;
    const map = JSON.parse(rows[0].value || "{}");
    const entry = map[trackingId];
    if (!entry || typeof entry !== "object") return null;
    return entry;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ trackingId: string }> }
) {
  // Always return the pixel — even if logging fails
  try {
    const raw = (await context.params)?.trackingId || "";
    let trackingId = String(raw).trim();
    try {
      trackingId = decodeURIComponent(trackingId);
    } catch {
      // keep raw
    }
    trackingId = trackingId.split("?")[0].split("&")[0].trim();

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

      try {
        await db
          .update(queue)
          .set({
            openCount: (qItem.openCount || 0) + 1,
            lastOpenedAt: openedAt,
          })
          .where(eq(queue.id, qItem.id));
      } catch (e) {
        console.error("queue openCount update failed:", e);
      }

      try {
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
      } catch (e) {
        console.error("trackingLogs insert (queue) failed:", e);
      }

      recordOpenOnAutoSheet(trackingId, openedAtIso).catch((err) =>
        console.error("auto sheet open update failed:", err)
      );
    } else {
      // Manual-send path (no queue row)
      let manualEmail: string | null = null;
      let manualMark: string | null = null;
      let manualRef: string | null = null;

      // 1) Fast path: DB settings map written at send time
      const fromMap = await lookupManualMap(trackingId);
      if (fromMap) {
        manualEmail = fromMap.email || null;
        manualMark = fromMap.markName || "Manual Send";
        manualRef = fromMap.referenceNo || "MANUAL";
      }

      // 2) Google Sheet (async-safe, may be slow / missing)
      try {
        const sheetRes = await recordOpenOnManualSheet(trackingId, openedAtIso);
        if (sheetRes?.success) {
          manualEmail = (sheetRes as any).email || manualEmail;
          manualMark =
            (sheetRes as any).markName || manualMark || "Manual Send";
          manualRef =
            (sheetRes as any).referenceNo || manualRef || "MANUAL";
        }
      } catch (err) {
        console.error("manual sheet open update failed:", err);
      }

      // Always log open — Unique Opens card reads tracking_logs
      try {
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
      } catch (e) {
        console.error("trackingLogs insert (manual) failed:", e);
      }
    }

    console.log(
      `[TRACKING PIXEL] Logged open trackId=${trackingId} ip=${ipAddress}`
    );
  } catch (error) {
    console.error("Error in open tracking route:", error);
  }

  return pixelResponse();
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ trackingId: string }> }
) {
  return GET(request, context);
}
