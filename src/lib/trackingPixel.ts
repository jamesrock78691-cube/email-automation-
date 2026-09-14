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
  // ALWAYS use stable production origin for open tracking.
  // Never embed localhost / preview / wrong host — those opens never hit prod DB.
  let origin = PRODUCTION_FALLBACK;
  const envUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
  if (envUrl && !/localhost|127\.0\.0\.1/i.test(envUrl)) {
    origin = envUrl;
  } else if (baseUrl) {
    const b = String(baseUrl).trim().replace(/\/$/, "");
    if (
      b &&
      !/localhost|127\.0\.0\.1/i.test(b) &&
      !/-[a-z0-9]+-[a-z0-9]+\.vercel\.app/i.test(b)
    ) {
      origin = /^https?:\/\//i.test(b) ? b : `https://${b}`;
    }
  }
  if (!/^https?:\/\//i.test(origin)) {
    origin = `https://${origin}`;
  }

  const id = encodeURIComponent(String(trackingId || "").trim());
  if (!id) return "";

  // Stable per-email URL (Gmail image proxy caches by URL)
  const src = `${origin}/api/track/${id}`;

  // Keep pixel loadable (no display:none / visibility:hidden / opacity:0)
  return (
    `<img src="${src}" width="1" height="1" border="0" alt="" ` +
    `style="width:1px;height:1px;border:0;outline:none;display:block;max-height:1px;" />`
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
  cleaned = cleaned.replace(/<img[^>]*\/api\/track\/[^>]*>/gi, "");

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
