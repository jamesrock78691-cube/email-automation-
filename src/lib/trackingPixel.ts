/** Invisible 1x1 open-tracking pixel. No alt text, no visible box. */

export function getAppBaseUrl(request?: { headers?: Headers }): string {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    "";
  if (envUrl.trim()) return envUrl.trim().replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
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

export function buildTrackingPixelHtml(baseUrl: string, trackingId: string): string {
  const origin = String(baseUrl || "").replace(/\/$/, "");
  const id = encodeURIComponent(String(trackingId || "").trim());
  const src = `${origin}/api/track/${id}`;
  return (
    `<img src="${src}" width="1" height="1" border="0" alt=""` +
    ` style="display:none!important;visibility:hidden;opacity:0;width:1px;height:1px;border:0;outline:none;max-height:0;overflow:hidden;mso-hide:all;" />`
  );
}

export function injectTrackingPixel(html: string, pixel: string): string {
  const source = html || "";
  const cleaned = source.replace(/{{\s*tracking_pixel\s*}}/gi, "");
  if (/\/api\/track\//i.test(cleaned)) return cleaned;
  if (/<\/body>/i.test(cleaned)) {
    return cleaned.replace(/<\/body>/i, `${pixel}</body>`);
  }
  return cleaned + pixel;
}
