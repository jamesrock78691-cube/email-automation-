/** Invisible 1x1 open-tracking pixel. Compatible with Gmail / Outlook / Apple Mail. */

export function getAppBaseUrl(request?: { headers?: Headers }): string {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "";
  if (envUrl.trim()) return envUrl.trim().replace(/\/$/, "");

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "");
    return `https://${host}`;
  }

  const host =
    request?.headers?.get("x-forwarded-host") ||
    request?.headers?.get("host") ||
    "";
  const proto = request?.headers?.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`.replace(/\/$/, "");

  return "https://email-automation-ten-mu.vercel.app";
}

/**
 * Build a 1x1 tracking pixel that email clients actually load.
 * Avoid display:none / visibility:hidden — many clients skip loading those images.
 */
export function buildTrackingPixelHtml(
  baseUrl: string,
  trackingId: string
): string {
  const origin = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  const id = encodeURIComponent(String(trackingId || "").trim());
  // cache-buster so proxies don't serve a cached empty response
  const src = `${origin}/api/track/${id}?t=${Date.now()}`;

  // Table-cell trick + real 1x1 size — loads in Gmail, Outlook, Apple Mail
  return (
    `<img src="${src}" width="1" height="1" border="0" alt="" ` +
    `style="width:1px;height:1px;border:0;outline:none;max-height:1px;max-width:1px;" />`
  );
}

/**
 * Inject pixel once, just before </body> when possible.
 * Works on full documents and fragments.
 */
export function injectTrackingPixel(html: string, pixel: string): string {
  const source = String(html || "");
  if (!pixel) return source;

  // Remove placeholder if template had it
  let cleaned = source.replace(/{{\s*tracking_pixel\s*}}/gi, "");

  // Already has a track URL from a previous inject — don't double
  if (/\/api\/track\//i.test(cleaned)) return cleaned;

  // Prefer just before </body>
  if (/<\/body\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }

  // Full document without closing body (rare) — append before </html>
  if (/<\/html\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/html\s*>/i, `${pixel}</html>`);
  }

  // Fragment — append at end
  return cleaned + pixel;
}
