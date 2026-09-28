import { pool, forceQueueWorkspaceColumn } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pool.query("select 1");
    let schema: any = { ok: false };
    try {
      await forceQueueWorkspaceColumn();
      const cols = await pool.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'queue'
         ORDER BY ordinal_position`
      );
      schema = {
        ok: true,
        queueColumns: cols.rows.map((r: any) => r.column_name),
        hasWorkspace: cols.rows.some((r: any) => r.column_name === "workspace"),
      };
    } catch (e: any) {
      schema = { ok: false, error: e?.message || String(e) };
    }
    return Response.json({ ok: true, schema });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: e?.message || String(e) },
      { status: 500 }
    );
  }
}
