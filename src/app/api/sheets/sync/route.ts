import { NextResponse } from "next/server";
import { getPendingRows } from "@/app/services/googleSheets";

export async function GET() {
  try {
    const rows = await getPendingRows();

    return NextResponse.json({
      success: true,
      total: rows.length,
      rows,
    });
  } catch (error: any) {
    console.error(error);

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