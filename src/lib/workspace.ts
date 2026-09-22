import { eq, or, isNull, and, SQL } from "drizzle-orm";

export const MAIN_WORKSPACE = "main";
export const AMAZON_WORKSPACE = "amazon";

export function resolveWorkspace(
  username?: string | null,
  stored?: string | null
): string {
  const s = String(stored || "").trim().toLowerCase();
  if (s) return s;
  const u = String(username || "").trim().toLowerCase();
  if (u === "amazon") return AMAZON_WORKSPACE;
  return MAIN_WORKSPACE;
}

/** Settings keys stay unprefixed for main so existing data keeps working. */
export function settingKey(base: string, ws: string): string {
  if (!ws || ws === MAIN_WORKSPACE) return base;
  return `${base}__${ws}`;
}

export function workspaceSql(column: any, ws: string): SQL {
  if (ws === MAIN_WORKSPACE) {
    return or(eq(column, MAIN_WORKSPACE), isNull(column), eq(column, "")) as SQL;
  }
  return eq(column, ws) as SQL;
}

/** Read workspace from session token (Bearer or cookie). */
export function workspaceFromRequest(req: {
  headers: { get: (k: string) => string | null };
  cookies?: { get: (k: string) => { value: string } | undefined };
}): string {
  try {
    const auth = req.headers.get("authorization");
    const token = auth?.startsWith("Bearer ")
      ? auth.slice(7).trim()
      : req.cookies?.get?.("ea_session")?.value || "";
    if (!token || !token.includes(".")) return MAIN_WORKSPACE;
    const payloadB64 = token.split(".")[0];
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const data = JSON.parse(json);
    return resolveWorkspace(data.username, data.workspace);
  } catch {
    return MAIN_WORKSPACE;
  }
}
