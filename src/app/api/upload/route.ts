import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: "No file uploaded.",
        },
        {
          status: 400,
        }
      );
    }

    const allowed = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/zip",
];

    if (!allowed.includes(file.type)) {
      return NextResponse.json(
        {
          success: false,
          error: "Allowed files: PDF, DOC, DOCX, XLS, XLSX, CSV, ZIP, JPG, PNG.",
        },
        {
          status: 400,
        }
      );
    }

    const uploadDir = path.join(process.cwd(), "uploads", "attachments");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, {
        recursive: true,
      });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const filename =
      Date.now() +
      "_" +
      file.name.replace(/\s+/g, "_");

    const filepath = path.join(uploadDir, filename);

    fs.writeFileSync(filepath, buffer);

    return NextResponse.json({
      success: true,
      filename,
      originalName: file.name,
      path: filepath,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      {
        status: 500,
      }
    );
  }
}