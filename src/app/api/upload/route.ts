import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

const MAX_BYTES = 4.5 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".txt": "text/plain",
};

const ALLOWED_EXT = new Set(Object.keys(EXT_MIME));
const ALLOWED_MIME = new Set([
  ...Object.values(EXT_MIME),
  "image/jpg",
  "application/octet-stream",
]);

function getExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "No file uploaded." },
        { status: 400 }
      );
    }

    const originalName = String(file.name || "attachment").replace(
      /[^\w.\- ()[\]]+/g,
      "_"
    );
    const ext = getExt(originalName);

    const mimeOk =
      !file.type ||
      ALLOWED_MIME.has(file.type) ||
      file.type === "application/octet-stream";
    const extOk = ALLOWED_EXT.has(ext);

    if (!extOk && !ALLOWED_MIME.has(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Allowed: PDF, PNG, JPG, GIF, WEBP, DOC, DOCX, XLS, XLSX, CSV, ZIP, TXT.",
        },
        { status: 400 }
      );
    }
    if (!mimeOk && !extOk) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Allowed: PDF, PNG, JPG, GIF, WEBP, DOC, DOCX, XLS, XLSX, CSV, ZIP, TXT.",
        },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB).`,
        },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(bytes);
    const contentBase64 = buffer.toString("base64");
    const contentType =
      (file.type && file.type !== "application/octet-stream"
        ? file.type
        : null) ||
      EXT_MIME[ext] ||
      "application/octet-stream";

    const filename = `${Date.now()}_${originalName.replace(/\s+/g, "_")}`;

    const blobKey = `att_blob:${filename}`;
    const blobValue = JSON.stringify({
      contentBase64,
      contentType,
      originalName,
      size: buffer.length,
    });
    try {
      const existing = await db
        .select()
        .from(settings)
        .where(eq(settings.key, blobKey))
        .limit(1);
      if (existing.length) {
        await db
          .update(settings)
          .set({ value: blobValue })
          .where(eq(settings.key, blobKey));
      } else {
        await db.insert(settings).values({ key: blobKey, value: blobValue });
      }
    } catch (dbErr) {
      console.error("att_blob save failed:", dbErr);
    }

    return NextResponse.json({
      success: true,
      filename,
      originalName,
      contentType,
      size: buffer.length,
      contentBase64,
      path: path.join("uploads", "attachments", filename),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}
