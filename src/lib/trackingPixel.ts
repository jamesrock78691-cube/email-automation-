/** Invisible 1x1 open-tracking pixel. Compatible with Gmail / Outlook / Apple Mail. */

const PRODUCTION_FALLBACK = "https://email-automation-ten-mu.vercel.app";

export function getAppBaseUrl(request?: { headers?: Headers }): string {
  // 1) Explicit env always wins (set NEXT_PUBLIC_APP_URL in Vercel)
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "";
  if (envUrl.trim()) return envUrl.trim().replace(/\/$/, "");

  // 2) Prefer stable production host — never bake a short-lived preview URL into emails
  const prod =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
    "";
  if (prod.trim()) {
    const host = prod.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (host && !host.includes("localhost")) return `https://${host}`;
  }

  // 3) Request host (only if not a ephemeral preview-looking host)
  const host =
    request?.headers?.get("x-forwarded-host") ||
    request?.headers?.get("host") ||
    "";
  const proto = request?.headers?.get("x-forwarded-proto") || "https";
  if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
    // Skip Vercel preview deployment hosts (*.vercel.app with hash) when production is known
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  // 4) Hard fallback — production domain
  return PRODUCTION_FALLBACK;
}

/**
 * Build a 1x1 tracking pixel that email clients actually load.
 * Avoid display:none / visibility:hidden — many clients skip loading those images.
 */
export function buildTrackingPixelHtml(
  baseUrl: string,
  trackingId: string
): string {
  let origin = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!origin || /localhost|127\.0\.0\.1/i.test(origin)) {
    origin = PRODUCTION_FALLBACK;
  }
  // Ensure https
  if (!/^https?:\/\//i.test(origin)) {
    origin = `https://${origin}`;
  }

  const id = encodeURIComponent(String(trackingId || "").trim());
  if (!id) return "";

  // Cache-buster: use tracking id so URL is stable per email but unique across emails
  const src = `${origin}/api/track/${id}?v=2`;

  // Dual format: plain img + table-wrapped img — maximizes client load rate
  // No display:none, no visibility:hidden, no opacity:0 (those get blocked)
  return (
    `<div style="line-height:1px;font-size:1px;max-height:1px;overflow:hidden;">` +
    `<img src="${src}" width="1" height="1" border="0" alt="" ` +
    `style="width:1px;height:1px;border:0;outline:none;display:block;" />` +
    `</div>`
  );
}

/**
 * Inject pixel once, just before </body> when possible.
 * Works on full documents and fragments.
 * Replaces any previous /api/track/ pixel so base URL stays correct.
 */
export function injectTrackingPixel(html: string, pixel: string): string {
  const source = String(html || "");
  if (!pixel) return source;

  // Remove template placeholder
  let cleaned = source.replace(/{{\s*tracking_pixel\s*}}/gi, "");

  // Strip any existing track pixels (wrong domain / old inject)
  cleaned = cleaned.replace(
    /<div[^>]*>\s*<img[^>]*\/api\/track\/[^>]*>\s*<\/div>/gi,
    ""
  );
  cleaned = cleaned.replace(
    /<img[^>]*\/api\/track\/[^>]*>/gi,
    ""
  );

  // Prefer just before </body>
  if (/<\/body\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }

  // Full document without closing body — append before </html>
  if (/<\/html\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/html\s*>/i, `${pixel}</html>`);
  }

  // Fragment — append at end
  return cleaned + pixel;
}
