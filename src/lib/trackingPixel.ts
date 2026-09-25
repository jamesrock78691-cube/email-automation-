/** Open-tracking pixel — Gmail / Outlook / Apple Mail friendly. */

export function getAppBaseUrl(request?: { headers?: Headers }): string {
  const envUrl =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "";
  if (envUrl.trim()) return envUrl.trim().replace(/\/$/, "");

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "";
  if (vercel.trim()) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (host && !host.includes("localhost")) return `https://${host}`;
  }

  const host =
    request?.headers?.get("x-forwarded-host") ||
    request?.headers?.get("host") ||
    "";
  const proto = request?.headers?.get("x-forwarded-proto") || "https";
  if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
    return `${proto}://${host}`.replace(/\/$/, "");
  }

  return "https://email-automation-ten-mu.vercel.app";
}

function resolvePixelOrigin(baseUrl?: string): string {
  const fromBase = String(baseUrl || "").trim().replace(/\/$/, "");
  if (fromBase && !/localhost|127\.0\.0\.1/i.test(fromBase)) {
    return /^https?:\/\//i.test(fromBase) ? fromBase : `https://${fromBase}`;
  }
  return getAppBaseUrl();
}

/**
 * Build a tracking pixel Gmail actually loads.
 * Uses /p/{id}.png (looks like a normal image, not /api/track).
 * Injected at TOP of <body> so Gmail "clipped message" still fires the open.
 */
export function buildTrackingPixelHtml(
  baseUrl: string,
  trackingId: string,
  recipientEmail?: string | null
): string {
  const origin = resolvePixelOrigin(baseUrl);
  const id = encodeURIComponent(String(trackingId || "").trim());
  if (!id) return "";

  let src = `${origin}/p/${id}.png`;
  const email = String(recipientEmail || "").trim().toLowerCase();
  if (email && email.includes("@")) {
    src += `?e=${encodeURIComponent(email)}`;
  }

  // 3x3, table-wrapped, never display:none — Gmail skips hidden 1x1 trackers
  return (
    `<table role="presentation" border="0" cellpadding="0" cellspacing="0" ` +
    `style="border-collapse:collapse;"><tr><td style="font-size:0;line-height:0;">` +
    `<img src="${src}" width="3" height="3" alt="" border="0" ` +
    `style="width:3px;height:3px;border:0;display:block;" />` +
    `</td></tr></table>`
  );
}

/**
 * Inject at the START of <body> (Gmail clips the bottom of long trademark emails)
 * and also before </body> as fallback.
 */
export function injectTrackingPixel(html: string, pixel: string): string {
  const source = String(html || "");
  if (!pixel) return source;

  let cleaned = source.replace(/{{\s*tracking_pixel\s*}}/gi, "");

  cleaned = cleaned.replace(
    /<table[^>]*>\s*<tr>\s*<td[^>]*>\s*<img[^>]*\/(p|api\/track)\/[^>]*>\s*<\/td>\s*<\/tr>\s*<\/table>/gi,
    ""
  );
  cleaned = cleaned.replace(/<img[^>]*\/api\/track\/[^>]*>/gi, "");
  cleaned = cleaned.replace(/<img[^>]*\/p\/[^>]*\.png[^>]*>/gi, "");

  if (/<body[^>]*>/i.test(cleaned)) {
    cleaned = cleaned.replace(/<body([^>]*)>/i, `<body$1>${pixel}`);
    return cleaned;
  }
  if (/<\/body\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/body\s*>/i, `${pixel}</body>`);
  }
  if (/<\/html\s*>/i.test(cleaned)) {
    return cleaned.replace(/<\/html\s*>/i, `${pixel}</html>`);
  }
  return pixel + cleaned;
}
