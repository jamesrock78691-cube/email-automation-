import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

const SETTING_KEY = "next_reference_no";
const START_FROM = 1111;
const MAX_VALUE = 1000000;

/**
 * GET  → current next number (without consuming)
 * POST → next number assign karta hai (1111, 1112, 1113...)
 */
export async function GET() {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTING_KEY))
      .limit(1);

    let next = START_FROM;
    if (rows.length > 0) {
      const parsed = parseInt(rows[0].value, 10);
      if (!isNaN(parsed) && parsed >= START_FROM) {
        next = parsed;
      }
    }

    return NextResponse.json({
      success: true,
      nextReferenceNo: String(next),
    });
  } catch (err: any) {
    console.error("GET /api/reference-no error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to fetch reference number" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let resetTo: number | null = null;
    try {
      const body = await request.json().catch(() => ({}));
      if (body?.resetTo != null) {
        resetTo = parseInt(String(body.resetTo), 10);
      }
    } catch {}

    const existing = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTING_KEY))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(settings).values({
        key: SETTING_KEY,
        value: String(START_FROM),
      });
    }

    if (resetTo != null && !isNaN(resetTo) && resetTo >= START_FROM && resetTo <= MAX_VALUE) {
      await db
        .update(settings)
        .set({ value: String(resetTo) })
        .where(eq(settings.key, SETTING_KEY));

      return NextResponse.json({
        success: true,
        referenceNo: String(resetTo),
        message: `Reference counter reset to ${resetTo}`,
      });
    }

    const currentRows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, SETTING_KEY))
      .limit(1);

    let current = START_FROM;
    if (currentRows.length > 0) {
      const parsed = parseInt(currentRows[0].value, 10);
      if (!isNaN(parsed) && parsed >= START_FROM) {
        current = parsed;
      }
    }

    if (current > MAX_VALUE) {
      return NextResponse.json(
        {
          success: false,
          error: `Reference number limit reached (${MAX_VALUE}). Contact admin to reset.`,
        },
        { status: 400 }
      );
    }

    const assigned = current;
    const nextValue = current + 1;

    await db
      .update(settings)
      .set({ value: String(nextValue) })
      .where(eq(settings.key, SETTING_KEY));

    return NextResponse.json({
      success: true,
      referenceNo: String(assigned),
      nextWillBe: String(nextValue),
    });
  } catch (err: any) {
    console.error("POST /api/reference-no error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to generate reference number" },
      { status: 500 }
    );
  }
}