import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { templates } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { quillToEmailHtml } from "@/lib/quillToEmailHtml";
import { workspaceSql } from "@/lib/workspace";
import {
  getSessionFromRequest,
  normalizeRole,
} from "@/lib/authSession";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

    const ws = session.workspace;
    const list = await db
      .select()
      .from(templates)
      .where(workspaceSql(templates.workspace, ws))
      .orderBy(desc(templates.createdAt));

    return NextResponse.json({
      success: true,
      list,
      workspace: ws,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { name, subject, bodyHtml, bodyText, attachmentsJson } = body;

    if (!name || !subject || !bodyHtml) {
      return NextResponse.json(
        {
          success: false,
          error: "Name, Subject and Body HTML are required",
        },
        { status: 400 }
      );
    }

    const ws = session.workspace;
    const inserted = await db
      .insert(templates)
      .values({
        name,
        subject,
        bodyHtml: quillToEmailHtml(String(bodyHtml || "")),
        bodyText: bodyText || "",
        attachmentsJson: attachmentsJson || "[]",
        workspace: ws,
      })
      .returning();

    return NextResponse.json({
      success: true,
      template: inserted[0],
      workspace: ws,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { id, name, subject, bodyHtml, bodyText, attachmentsJson } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Template ID is required" },
        { status: 400 }
      );
    }

    const ws = session.workspace;
    const existing = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, Number(id)),
          workspaceSql(templates.workspace, ws)
        )
      )
      .limit(1);

    if (!existing.length) {
      return NextResponse.json(
        { success: false, error: "Template not found in your workspace" },
        { status: 404 }
      );
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (subject !== undefined) updates.subject = subject;
    if (bodyHtml !== undefined)
      updates.bodyHtml = quillToEmailHtml(String(bodyHtml || ""));
    if (bodyText !== undefined) updates.bodyText = bodyText;
    if (attachmentsJson !== undefined) updates.attachmentsJson = attachmentsJson;

    const updated = await db
      .update(templates)
      .set(updates)
      .where(
        and(
          eq(templates.id, Number(id)),
          workspaceSql(templates.workspace, ws)
        )
      )
      .returning();

    return NextResponse.json({
      success: true,
      template: updated[0],
      workspace: ws,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: "Template ID is required" },
        { status: 400 }
      );
    }

    const ws = session.workspace;
    const deleted = await db
      .delete(templates)
      .where(
        and(
          eq(templates.id, Number(id)),
          workspaceSql(templates.workspace, ws)
        )
      )
      .returning();

    if (!deleted.length) {
      return NextResponse.json(
        { success: false, error: "Template not found in your workspace" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Template deleted successfully",
      workspace: ws,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
