import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { campaigns, templates } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const list = await db
      .select({
        id: campaigns.id,
        name: campaigns.name,
        templateId: campaigns.templateId,
        status: campaigns.status,
        scheduledAt: campaigns.scheduledAt,
        createdAt: campaigns.createdAt,
        templateName: templates.name,
      })
      .from(campaigns)
      .leftJoin(templates, eq(campaigns.templateId, templates.id))
      .orderBy(desc(campaigns.createdAt));

    return NextResponse.json({ success: true, list });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, templateId, status, scheduledAt } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: "Campaign name is required" }, { status: 400 });
    }

    const inserted = await db.insert(campaigns).values({
      name,
      templateId: templateId ? Number(templateId) : null,
      status: status || "draft",
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
    }).returning();

    return NextResponse.json({ success: true, campaign: inserted[0] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, templateId, status, scheduledAt } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "Campaign ID is required" }, { status: 400 });
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (templateId !== undefined) updates.templateId = templateId ? Number(templateId) : null;
    if (status !== undefined) updates.status = status;
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    const updated = await db
      .update(campaigns)
      .set(updates)
      .where(eq(campaigns.id, Number(id)))
      .returning();

    return NextResponse.json({ success: true, campaign: updated[0] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ success: false, error: "Campaign ID is required" }, { status: 400 });
    }

    await db.delete(campaigns).where(eq(campaigns.id, Number(id)));
    return NextResponse.json({ success: true, message: "Campaign deleted successfully" });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
