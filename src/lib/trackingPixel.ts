/** Invisible 1x1 open-tracking pixel. Compatible with Gmail / Outlook / Apple Mail. */

const PRODUCTION_FALLBACK = "https://email-automation-ten-mu.vercel.app";

export function getAppBaseUrl(request?: { headers?: Headers }): string {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
  if (envUrl.trim()) return envUrl.trim().replace(/\/$/, "");

  const prod =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
    "";
  if (prod.trim()) {
    const host = prod.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (host && !host.includes("localhost")) return `https://${host}`;
  }

  const host =
    request?.headers?.get("x-forwarded-host") ||
    request?.headers?.get("host") ||
    "";
  const proto = request?.headers?.get("x-forwarded-proto") || "https";
  if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
    // Skip ephemeral Vercel preview hosts (…-hash-…vercel.app)
    if (!/^[a-z0-9-]+-[a-z0-9]{8,}-[a-z0-9-]+\.vercel\.app$/i.test(host)) {
      return `${proto}://${host}`.replace(/\/$/, "");
    }
  }

  return PRODUCTION_FALLBACK;
}

function resolvePixelOrigin(baseUrl?: string): string {
  // 1) Explicit env
  const envUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (envUrl && !/localhost|127\.0\.0\.1/i.test(envUrl)) {
    return /^https?:\/\//i.test(envUrl) ? envUrl : `https://${envUrl}`;
  }

  // 2) Always prefer hard production fallback for pixels baked into emails
  // (preview / wrong hosts never receive opens in prod DB)
  return PRODUCTION_FALLBACK;
}

/**
 * Build a 1x1 tracking pixel that email clients actually load.
 * Optional recipientEmail is encoded as ?e= so opens are attributed even without queue/map.
 */
export function buildTrackingPixelHtml(
  baseUrl: string,
  trackingId: string,
  recipientEmail?: string | null
): string {
  const origin = resolvePixelOrigin(baseUrl);
  const id = encodeURIComponent(String(trackingId || "").trim());
  if (!id) return "";

  let src = `${origin}/api/track/${id}`;
  const email = String(recipientEmail || "").trim().toLowerCase();
  if (email && email.includes("@")) {
    src += `?e=${encodeURIComponent(email)}`;
  }

  // Loadable pixel — no display:none / visibility:hidden / opacity:0
  // (many clients skip loading hidden images)
  return (
    `<img src="${src}" width="1" height="1" border="0" alt="" ` +
    `style="width:1px;height:1px;border:0;outline:none;display:block;max-height:1px;" />`
  );
}

/**
 * Inject pixel once, just before </body> when possible.
 * Strips any previous /api/track/ pixel so domain/email stay correct.
 */
export function injectTrackingPixel(html: string, pixel: string): string {
  const source = String(html || "");
  if (!pixel) return source;

  let cleaned = source.replace(/{{\s*tracking_pixel\s*}}/gi, "");

  cleaned = cleaned.replace(
    /<div[^>]*>\s*<img[^>]*\/api\/track\/[^>]*>\s*<\/div>/gi,
    ""
  );
  cleaned = cleaned.replace(/<img[^>]*\/api\/track\/[^>]*>/gi, "");

  if (/<\/body\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }
  if (/<\/html\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/html\s*>/i, `${pixel}</html>`);
  }
  return cleaned + pixel;
}
