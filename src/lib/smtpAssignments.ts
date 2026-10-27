import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { settingKey, MAIN_WORKSPACE } from "@/lib/workspace";

/**
 * Stored shape (UI checkboxes):
 *   { [accountId: string]: userId[] }
 * e.g. { "12": [3, 5], "15": [3] }
 */
export async function loadSmtpAssignmentMap(
  ws?: string | null
): Promise<Record<string, number[]>> {
  try {
    const key = settingKey("smtp_assignments", ws || MAIN_WORKSPACE);
    const rows = await db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .limit(1);
    if (!rows.length) return {};
    const map = JSON.parse(rows[0].value || "{}");
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

/** Invert account→users map into account ids allowed for this user. */
export function allowedSmtpIdsForUser(
  map: Record<string, number[]>,
  userId?: number | string | null,
  username?: string | null
): number[] {
  const uid = userId != null && userId !== "" ? Number(userId) : NaN;
  const uname = String(username || "").trim().toLowerCase();
  const out: number[] = [];
  for (const [accId, userIds] of Object.entries(map || {})) {
    const id = Number(accId);
    if (!id || id <= 0) continue;
    const arr = Array.isArray(userIds) ? userIds : [];
    const hit = arr.some((u) => {
      const n = Number(u);
      if (Number.isFinite(uid) && Number.isFinite(n) && n === uid) return true;
      if (uname && String(u).trim().toLowerCase() === uname) return true;
      return false;
    });
    if (hit) out.push(id);
  }
  return out;
}
