/** Optional HTML sanitizer shim — keep this a real module so Next build succeeds. */
export function makeEmailSafeHtml(html: string): string {
  return String(html || "");
}

export default makeEmailSafeHtml;
