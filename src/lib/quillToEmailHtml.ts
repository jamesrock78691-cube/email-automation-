/** Quill to email HTML - real renderable HTML for SMTP */

const LT = "\u003c";
const GT = "\u003e";
const AMP = "\u0026";

function unescapeHtmlEntities(html: string): string {
  if (!html) return html;

  let out = html;
  // Always run entity decode (safe if already unescaped)
  out = out.replace(/&#0*60;/g, LT).replace(/&#x0*3c;/gi, LT);
  out = out.replace(/&#0*62;/g, GT).replace(/&#x0*3e;/gi, GT);
  out = out.replace(/&#0*38;/g, AMP).replace(/&#x0*26;/gi, AMP);
  out = out.split(AMP + "lt;").join(LT).split(AMP + "LT;").join(LT);
  out = out.split(AMP + "gt;").join(GT).split(AMP + "GT;").join(GT);
  out = out.split(AMP + "quot;").join('"').split(AMP + "QUOT;").join('"');
  out = out.split("&#39;").join("'").split(AMP + "apos;").join("'");
  out = out
    .split(AMP + "nbsp;")
    .join("\u00a0")
    .split(AMP + "NBSP;")
    .join("\u00a0");
  // amp last so we don't re-escape
  out = out.split(AMP + "amp;").join(AMP).split(AMP + "AMP;").join(AMP);
  return out;
}

/**
 * If the stored template already contains a full HTML document
 * (often nested inside a data-ea-converted div from a previous save),
 * extract ONE clean document. Nested <!DOCTYPE>/<html> breaks Gmail
 * and many clients into plain-text fallback.
 */
function extractCleanFullDocument(html: string): string | null {
  const raw = String(html || "").trim();
  if (!raw) return null;

  // Prefer the last (innermost) complete document if nested
  const doctypeIdx = raw.toLowerCase().lastIndexOf("<!doctype");
  const htmlTagIdx = raw.toLowerCase().lastIndexOf("<html");
  const start =
    doctypeIdx >= 0
      ? doctypeIdx
      : htmlTagIdx >= 0
        ? htmlTagIdx
        : -1;
  if (start < 0) return null;

  let doc = raw.slice(start);

  // Trim anything after the final </html>
  const closeHtml = doc.toLowerCase().lastIndexOf("</html>");
  if (closeHtml >= 0) {
    doc = doc.slice(0, closeHtml + 7);
  }

  // Ensure charset meta exists
  if (!/charset\s*=/i.test(doc)) {
    if (/<head[^>]*>/i.test(doc)) {
      doc = doc.replace(
        /<head([^>]*)>/i,
        '<head$1>\n<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />\n<meta charset="UTF-8" />'
      );
    } else if (/<html[^>]*>/i.test(doc)) {
      doc = doc.replace(
        /<html([^>]*)>/i,
        '<html$1>\n<head>\n<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />\n<meta charset="UTF-8" />\n</head>'
      );
    }
  }

  // Must still look like a document
  if (!/<html[\s>]/i.test(doc) && !/<!DOCTYPE/i.test(doc)) return null;
  return doc.trim();
}

export function wrapEmailHtmlDocument(bodyHtml: string): string {
  const body = String(bodyHtml || "").trim();
  if (!body) return "";

  // Already a full document?
  const existing = extractCleanFullDocument(body);
  if (existing) return existing;

  if (/<html[\s>]/i.test(body)) {
    if (!/charset\s*=/i.test(body)) {
      return body.replace(
        /<head([^>]*)>/i,
        '<head$1><meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />'
      );
    }
    return body;
  }

  return (
    "<!DOCTYPE html>\n" +
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="en">\n' +
    "<head>\n" +
    '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "<title>Email</title>\n" +
    "</head>\n" +
    '<body style="margin:0;padding:12px;background-color:#ffffff;-webkit-text-size-adjust:100%;">\n' +
    body +
    "\n</body>\n</html>"
  );
}

export function htmlToPlainText(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(new RegExp(AMP + "nbsp;", "gi"), " ")
    .replace(new RegExp(AMP + "amp;", "gi"), AMP)
    .replace(new RegExp(AMP + "lt;", "gi"), LT)
    .replace(new RegExp(AMP + "gt;", "gi"), GT)
    .replace(new RegExp(AMP + "quot;", "gi"), '"')
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Main entry for outbound emails.
 * Handles 3 cases:
 *  1. Full HTML document (even if wrapped in data-ea-converted) → extract clean doc
 *  2. Quill fragment with classes → convert + wrap
 *  3. Already-converted fragment → wrap only
 */
export function toSendableEmailHtml(html: string): string {
  let input = unescapeHtmlEntities(String(html || ""));

  // Second pass if still escaped (double-encoded templates)
  if (/<[a-zA-Z]|&#0*60;/i.test(input)) {
    input = unescapeHtmlEntities(input);
  }

  // CASE 1: already a full document (common for trademark templates)
  // even when nested inside <div data-ea-converted="1">...</div>
  const fullDoc = extractCleanFullDocument(input);
  if (fullDoc) {
    return fullDoc;
  }

  // CASE 2/3: fragment → quill convert then wrap
  const converted = quillToEmailHtml(input);
  return wrapEmailHtmlDocument(converted);
}

export function quillToEmailHtml(html: string): string {
  if (!html || !html.trim()) return html;
  let result = unescapeHtmlEntities(html);

  // If someone passes a full document into quill path, strip to body first
  if (/<html[\s>]/i.test(result) || /<!DOCTYPE/i.test(result)) {
    const bodyMatch = result.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) result = bodyMatch[1];
  }

  // Strip outer data-ea-converted wrapper if present (re-process cleanly)
  const eaMatch = result.match(
    /<div[^>]*data-ea-converted\s*=\s*["']1["'][^>]*>([\s\S]*)<\/div>\s*$/i
  );
  if (eaMatch) {
    result = eaMatch[1];
  }

  // If after strip we still have a full document, return body only for further processing
  if (/<html[\s>]/i.test(result) || /<!DOCTYPE/i.test(result)) {
    const bodyMatch2 = result.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch2) result = bodyMatch2[1];
  }

  const applyAlign = (align: string) => {
    const reOnly = new RegExp(
      `<([a-zA-Z0-9]+)([^>]*?)\\sclass="([^"]*?)\\bql-align-${align}\\b([^"]*?)"([^>]*?)>`,
      "gi"
    );
    result = result.replace(reOnly, (_m, tag, before, c1, c2, after) => {
      const restClass = `${c1}${c2}`.replace(/\s+/g, " ").trim();
      const attrs = `${before}${after}`;
      if (/\sstyle="/i.test(attrs) || /\sstyle='/i.test(attrs)) {
        let out = `<${tag}${before} class="${restClass}"${after}>`;
        out = out.replace(/style="([^"]*)"/i, (_sm: string, styles: string) => {
          if (/text-align\s*:/i.test(styles)) return `style="${styles}"`;
          return `style="text-align: ${align}; ${styles}"`;
        });
        out = out.replace(/style='([^']*)'/i, (_sm: string, styles: string) => {
          if (/text-align\s*:/i.test(styles)) return `style='${styles}'`;
          return `style='text-align: ${align}; ${styles}'`;
        });
        out = out.replace(/\sclass=""/, "").replace(/\sclass=''/, "");
        return out;
      }
      const clsAttr = restClass ? ` class="${restClass}"` : "";
      return `<${tag}${before}${clsAttr} style="text-align: ${align};"${after}>`;
    });
  };

  applyAlign("center");
  applyAlign("right");
  applyAlign("justify");
  applyAlign("left");

  result = result.replace(
    /<([a-zA-Z0-9]+)([^>]*?)\sclass="([^"]*?)\bql-size-([0-9.]+px)\b([^"]*?)"([^>]*?)>/gi,
    (_m, tag, before, c1, size, c2, after) => {
      const restClass = `${c1}${c2}`.replace(/\s+/g, " ").trim();
      const attrs = `${before}${after}`;
      if (/\sstyle="/i.test(attrs)) {
        let out = `<${tag}${before} class="${restClass}"${after}>`;
        out = out.replace(/style="([^"]*)"/i, (_sm: string, styles: string) => {
          if (/font-size\s*:/i.test(styles)) return `style="${styles}"`;
          return `style="font-size: ${size}; ${styles}"`;
        });
        return out.replace(/\sclass=""/, "");
      }
      const clsAttr = restClass ? ` class="${restClass}"` : "";
      return `<${tag}${before}${clsAttr} style="font-size: ${size};"${after}>`;
    }
  );

  const fonts: Record<string, string> = {
    arial: "Arial, Helvetica, sans-serif",
    helvetica: "Helvetica, Arial, sans-serif",
    "times-new-roman": "'Times New Roman', Times, serif",
    georgia: "Georgia, serif",
    verdana: "Verdana, Geneva, sans-serif",
    "courier-new": "'Courier New', Courier, monospace",
    tahoma: "Tahoma, Geneva, sans-serif",
    "trebuchet-ms": "'Trebuchet MS', sans-serif",
    garamond: "Garamond, serif",
    "comic-sans-ms": "'Comic Sans MS', cursive",
  };

  for (const [key, family] of Object.entries(fonts)) {
    const re = new RegExp(
      `<([a-zA-Z0-9]+)([^>]*?)\\sclass="([^"]*?)\\bql-font-${key}\\b([^"]*?)"([^>]*?)>`,
      "gi"
    );
    result = result.replace(re, (_m, tag, before, c1, c2, after) => {
      const restClass = `${c1}${c2}`.replace(/\s+/g, " ").trim();
      const attrs = `${before}${after}`;
      if (/\sstyle="/i.test(attrs)) {
        let out = `<${tag}${before} class="${restClass}"${after}>`;
        out = out.replace(/style="([^"]*)"/i, (_sm: string, styles: string) => {
          if (/font-family\s*:/i.test(styles)) return `style="${styles}"`;
          return `style="font-family: ${family}; ${styles}"`;
        });
        return out.replace(/\sclass=""/, "");
      }
      const clsAttr = restClass ? ` class="${restClass}"` : "";
      return `<${tag}${before}${clsAttr} style="font-family: ${family};"${after}>`;
    });
  }

  result = result.replace(
    /<([a-zA-Z0-9]+)([^>]*?)\sclass="([^"]*?)\bql-indent-(\d+)\b([^"]*?)"([^>]*?)>/gi,
    (_m, tag, before, c1, n, c2, after) => {
      const restClass = `${c1}${c2}`.replace(/\s+/g, " ").trim();
      const margin = `${parseInt(n, 10) * 3}em`;
      const attrs = `${before}${after}`;
      if (/\sstyle="/i.test(attrs)) {
        let out = `<${tag}${before} class="${restClass}"${after}>`;
        out = out.replace(/style="([^"]*)"/i, (_sm: string, styles: string) => {
          if (/margin-left\s*:/i.test(styles)) return `style="${styles}"`;
          return `style="margin-left: ${margin}; ${styles}"`;
        });
        return out.replace(/\sclass=""/, "");
      }
      const clsAttr = restClass ? ` class="${restClass}"` : "";
      return `<${tag}${before}${clsAttr} style="margin-left: ${margin};"${after}>`;
    }
  );

  result = result.replace(/\sclass=""/g, "").replace(/\sclass=''/g, "");
  return normalizeEmailSpacing(result);
}

function normalizeEmailSpacing(html: string): string {
  if (!html || !html.trim()) return html;
  let result = html;
  result = result.replace(
    /<p([^>]*)>\s*(?:<br\s*\/?>|\s)*\s*<\/p>/gi,
    '<p$1 style="margin:0;padding:0;line-height:1.5;"><br></p>'
  );
  const blocks = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li"];
  for (const tag of blocks) {
    const re = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
    result = result.replace(re, (full, attrs = "") => {
      attrs = attrs || "";
      const base = tag.startsWith("h")
        ? "margin:0;padding:0;line-height:1.4;"
        : "margin:0;padding:0;line-height:1.5;";
      if (/\sstyle\s*=\s*"/i.test(attrs)) {
        return full.replace(/style\s*=\s*"([^"]*)"/i, (_m, styles) => {
          let s = styles.trim();
          if (!/margin\s*:/i.test(s)) s = "margin:0; " + s;
          if (!/padding\s*:/i.test(s)) s = "padding:0; " + s;
          if (!/line-height\s*:/i.test(s)) s = "line-height:1.5; " + s;
          return `style="${s}"`;
        });
      }
      if (/\sstyle\s*=\s*'/i.test(attrs)) {
        return full.replace(/style\s*=\s*'([^']*)'/i, (_m, styles) => {
          let s = styles.trim();
          if (!/margin\s*:/i.test(s)) s = "margin:0; " + s;
          if (!/padding\s*:/i.test(s)) s = "padding:0; " + s;
          if (!/line-height\s*:/i.test(s)) s = "line-height:1.5; " + s;
          return `style='${s}'`;
        });
      }
      return `<${tag}${attrs} style="${base}">`;
    });
  }
  result = result.replace(/<ul(\s[^>]*)?>/gi, (full, attrs = "") => {
    attrs = attrs || "";
    if (/style\s*=/i.test(attrs)) return full;
    return `<ul${attrs} style="margin:0;padding-left:20px;line-height:1.5;">`;
  });
  result = result.replace(/<ol(\s[^>]*)?>/gi, (full, attrs = "") => {
    attrs = attrs || "";
    if (/style\s*=/i.test(attrs)) return full;
    return `<ol${attrs} style="margin:0;padding-left:20px;line-height:1.5;">`;
  });
  result = `<div data-ea-converted="1" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111111;">${result}</div>`;
  return result;
}
