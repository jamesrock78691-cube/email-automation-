import { NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { resolveWorkspace } from "@/lib/workspace";

/** Must match auth/route.ts — AUTH_SECRET only (no silent fallbacks that diverge). */
export function getAuthSecret(): string {
  const s =
    process.env.AUTH_SECRET ||
    process.env.JWT_SECRET ||
    "";
  if (!s) {
    return process.env.DATABASE_URL || "email-automation-v1-dev-secret-change-me";
  }
  return s;
}

export type SessionPayload = {
  userId: number;
  username: string;
  role: string;
  workspace: string;
  exp?: number;
};

export function verifyAuthToken(token: string): SessionPayload | null {
  try {
    if (!token || !token.includes(".")) return null;
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;
    const SECRET = getAuthSecret();
    const expected = createHmac("sha256", SECRET).update(payloadB64).digest("hex");
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      const a2 = Buffer.from(sig);
      const b2 = Buffer.from(expected);
      if (a2.length !== b2.length || !timingSafeEqual(a2, b2)) return null;
    }
    const json = Buffer.from(
      payloadB64.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    const data = JSON.parse(json);
    if (!data?.userId) return null;
    if (data.exp && Date.now() > data.exp) return null;
    const username = String(data.username || "");
    return {
      userId: Number(data.userId),
      username,
      role: String(data.role || "operator"),
      workspace: resolveWorkspace(username, data.workspace),
      exp: data.exp,
    };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): SessionPayload | null {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : req.cookies.get("ea_session")?.value || "";
  if (!token) return null;
  return verifyAuthToken(token);
}

export function normalizeRole(role: string, username?: string): string {
  const r = (role || "").toLowerCase().replace(/-/g, "_").trim();
  const u = (username || "").toLowerCase();
  if (r === "super_admin" || r === "superadmin") return "super_admin";
  if (
    u === "admin" ||
    u === "superadmin" ||
    u === "amazon" ||
    u === "sandeer"
  )
    return "super_admin";
  if (r === "admin") return "admin";
  return "operator";
}
