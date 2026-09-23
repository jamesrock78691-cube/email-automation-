import { eq, SQL } from "drizzle-orm";

export const MAIN_WORKSPACE = "main";
export const AMAZON_WORKSPACE = "amazon";

export function resolveWorkspace(
  username?: string | null,
  stored?: string | null
): string {
  const s = String(stored || "").trim().toLowerCase();
  if (s === AMAZON_WORKSPACE || s === "amazon") return AMAZON_WORKSPACE;
  if (s === MAIN_WORKSPACE || s === "main") return MAIN_WORKSPACE;
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

/** Strict filter — main and amazon never share rows. */
export function workspaceSql(column: any, ws: string): SQL {
  const w = resolveWorkspace(undefined, ws);
  return eq(column, w) as SQL;
}

function parseTokenWorkspace(token: string): {
  username: string;
  workspace: string;
} | null {
  try {
    if (!token || !token.includes(".")) return null;
    const payloadB64 = token.split(".")[0];
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const data = JSON.parse(json);
    if (!data || !data.username) return null;
    return {
      username: String(data.username),
      workspace: resolveWorkspace(data.username, data.workspace),
    };
  } catch {
    return null;
  }
}

function tokenFromRequest(req: {
  headers: { get: (k: string) => string | null };
  cookies?: { get: (k: string) => { value: string } | undefined };
}): string {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return req.cookies?.get?.("ea_session")?.value || "";
}

/**
 * Read workspace from session. Returns MAIN only if token is missing/invalid.
 * Prefer requireSessionWorkspace for mutating routes.
 */
export function workspaceFromRequest(req: {
  headers: { get: (k: string) => string | null };
  cookies?: { get: (k: string) => { value: string } | undefined };
}): string {
  const parsed = parseTokenWorkspace(tokenFromRequest(req));
  return parsed?.workspace || MAIN_WORKSPACE;
}

/**
 * Require a valid session token. Returns null if not logged in.
 * Use this for send/queue/gmail so anonymous never hits main data by accident.
 */
export function requireSessionWorkspace(req: {
  headers: { get: (k: string) => string | null };
  cookies?: { get: (k: string) => { value: string } | undefined };
}): { username: string; workspace: string } | null {
  return parseTokenWorkspace(tokenFromRequest(req));
}
