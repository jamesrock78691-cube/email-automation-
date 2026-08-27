import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { templates, settings, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";
import { quillToEmailHtml } from "@/lib/quillToEmailHtml";

const SECRET =
  process.env.AUTH_SECRET ||
  process.env.DATABASE_URL ||
  "email-automation-v1-dev-secret-change-me";

function verifyToken(token: string): { userId: number; role: string } | null {
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
    return { userId: payload.userId, role: payload.role || "operator" };
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

async function getOwners(): Promise<Record<string, number>> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "template_owners"))
      .limit(1);
    if (!rows.length) return {};
    return JSON.parse(rows[0].value || "{}");
  } catch {
    return {};
  }
}

async function setOwners(map: Record<string, number>) {
  const str = JSON.stringify(map);
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "template_owners"))
    .limit(1);
  if (rows.length) {
    await db
      .update(settings)
      .set({ value: str })
      .where(eq(settings.key, "template_owners"));
  } else {
    await db.insert(settings).values({ key: "template_owners", value: str });
  }
}

function normalizeRole(role: string, username?: string) {
  const r = (role || "").toLowerCase();
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

async function resolveUser(session: { userId: number; role: string }) {
  const userRow = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  const role = normalizeRole(
    userRow[0]?.role || session.role,
    userRow[0]?.username
  );
  return { user: userRow[0], role };
}

/** Only owner (or super_admin with scope=all) can access */
async function assertCanAccessTemplate(
  session: { userId: number; role: string },
  templateId: number,
  role: string
) {
  const owners = await getOwners();
  const ownerId = owners[String(templateId)];
  if (ownerId == null) {
    // Unowned legacy: only super_admin
    return role === "super_admin";
  }
  if (ownerId === session.userId) return true;
  return role === "super_admin";
}

export async function GET(request: NextRequest) {
  try {
    const session = getSession(request);
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Login required" },
        { status: 401 }
      );
    }

    const { role } = await resolveUser(session);
    const { searchParams } = new URL(request.url);
    const scopeAll =
      searchParams.get("scope") === "all" && role === "super_admin";

    const list = await db
      .select()
      .from(templates)
      .orderBy(desc(templates.createdAt));

    let owners = await getOwners();

       // Super Admin: restore legacy (unowned) templates → claim them
    if (role === "super_admin") {
      let claimed = false;
      for (const t of list) {
        const key = String(t.id);
        if (owners[key] == null) {
          owners[key] = session.userId;
          claimed = true;
        }
      }
      if (claimed) {
        await setOwners(owners);
        owners = await getOwners();
      }
    }

    if (scopeAll) {
      const withOwner = list.map((t) => ({
        ...t,
        ownerId: owners[String(t.id)] ?? null,
      }));
      return NextResponse.json({
        success: true,
        list: withOwner,
        scope: "all",
      });
    }

    // Super admin sees own + any still-unowned; others only own
    const filtered = list.filter((t) => {
      const ownerId = owners[String(t.id)];
      if (ownerId === session.userId) return true;
      if (role === "super_admin" && ownerId == null) return true;
      return false;
    });

    return NextResponse.json({
      success: true,
      list: filtered,
      scope: "own",
      ownerId: session.userId,
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
    const session = getSession(request);
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

    const inserted = await db
      .insert(templates)
      .values({
        name,
        subject,
        bodyHtml: quillToEmailHtml(String(bodyHtml || "")),
        bodyText: bodyText || "",
        attachmentsJson: attachmentsJson || "[]",
      })
      .returning();

    const tpl = inserted[0];
    if (tpl) {
      const owners = await getOwners();
      owners[String(tpl.id)] = session.userId;
      await setOwners(owners);
    }

    return NextResponse.json({
      success: true,
      template: tpl,
      ownerId: session.userId,
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
    const session = getSession(request);
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

    const { role } = await resolveUser(session);
    const allowed = await assertCanAccessTemplate(
      session,
      Number(id),
      role
    );
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: "Not your template" },
        { status: 403 }
      );
    }

    // If unowned and super_admin edits, claim ownership
    const owners = await getOwners();
    if (owners[String(id)] == null && role === "super_admin") {
      owners[String(id)] = session.userId;
      await setOwners(owners);
    }

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (subject !== undefined) updates.subject = subject;
    if (bodyHtml !== undefined) updates.bodyHtml = quillToEmailHtml(String(bodyHtml || ""));
    if (bodyText !== undefined) updates.bodyText = bodyText;
    if (attachmentsJson !== undefined) updates.attachmentsJson = attachmentsJson;

    const updated = await db
      .update(templates)
      .set(updates)
      .where(eq(templates.id, Number(id)))
      .returning();

    return NextResponse.json({ success: true, template: updated[0] });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = getSession(request);
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

    const { role } = await resolveUser(session);
    const allowed = await assertCanAccessTemplate(
      session,
      Number(id),
      role
    );
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: "Not your template" },
        { status: 403 }
      );
    }

    await db.delete(templates).where(eq(templates.id, Number(id)));
    const owners = await getOwners();
    delete owners[String(id)];
    await setOwners(owners);

    return NextResponse.json({
      success: true,
      message: "Template deleted successfully",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
