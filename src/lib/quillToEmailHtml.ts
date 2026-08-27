/**
 * Quill → email-safe HTML: inline align + ZERO extra line gaps (Gmail/Outlook)
 */
export function quillToEmailHtml(html: string): string {
  if (!html || !html.trim()) return html;

  let result = html;

  const applyAlign = (align: string) => {
    const re = new RegExp(
      `<([a-zA-Z0-9]+)([^>]*?)\\sclass="([^"]*?)\\bql-align-${align}\\b([^"]*?)"([^>]*?)>`,
      "gi"
    );
    result = result.replace(re, (_m, tag, before, c1, c2, after) => {
      const restClass = `${c1}${c2}`.replace(/\s+/g, " ").trim();
      const attrs = `${before}${after}`;
      if (/\sstyle="/i.test(attrs) || /\sstyle='/i.test(attrs)) {
        let out = `<${tag}${before} class="${restClass}"${after}>`;
        out = out.replace(/style="([^"]*)"/i, (_sm: string, styles: string) => {
          if (/text-align\s*:/i.test(styles)) return `style="${styles}"`;
          return `style="text-align:${align};${styles}"`;
        });
        return out.replace(/\sclass=""/, "");
      }
      const cls = restClass ? ` class="${restClass}"` : "";
      return `<${tag}${before}${cls} style="text-align:${align};"${after}>`;
    });
  };
  applyAlign("center");
  applyAlign("right");
  applyAlign("justify");
  applyAlign("left");

  result = result.replace(
    /<([a-zA-Z0-9]+)([^>]*?)\sclass="([^"]*?)\bql-size-([0-9.]+px)\b([^"]*?)"([^>]*?)>/gi,
    (_m, tag, before, c1, size, c2, after) => {
      const rest = `${c1}${c2}`.replace(/\s+/g, " ").trim();
      const cls = rest ? ` class="${rest}"` : "";
      const attrs = `${before}${after}`;
      if (/\sstyle="/i.test(attrs)) {
        return `<${tag}${before}${cls}${after}>`.replace(
          /style="([^"]*)"/i,
          (_s, st) =>
            /font-size\s*:/i.test(st) ? `style="${st}"` : `style="font-size:${size};${st}"`
        );
      }
      return `<${tag}${before}${cls} style="font-size:${size};"${after}>`;
    }
  );

  const fonts: Record<string, string> = {
    arial: "Arial,Helvetica,sans-serif",
    helvetica: "Helvetica,Arial,sans-serif",
    "times-new-roman": "'Times New Roman',Times,serif",
    georgia: "Georgia,serif",
    verdana: "Verdana,Geneva,sans-serif",
    "courier-new": "'Courier New',Courier,monospace",
    tahoma: "Tahoma,Geneva,sans-serif",
    "trebuchet-ms": "'Trebuchet MS',sans-serif",
    garamond: "Garamond,serif",
    "comic-sans-ms": "'Comic Sans MS',cursive",
  };
  for (const [key, family] of Object.entries(fonts)) {
    const re = new RegExp(
      `<([a-zA-Z0-9]+)([^>]*?)\\sclass="([^"]*?)\\bql-font-${key}\\b([^"]*?)"([^>]*?)>`,
      "gi"
    );
    result = result.replace(re, (_m, tag, before, c1, c2, after) => {
      const rest = `${c1}${c2}`.replace(/\s+/g, " ").trim();
      const cls = rest ? ` class="${rest}"` : "";
      const attrs = `${before}${after}`;
      if (/\sstyle="/i.test(attrs)) {
        return `<${tag}${before}${cls}${after}>`.replace(
          /style="([^"]*)"/i,
          (_s, st) =>
            /font-family\s*:/i.test(st)
              ? `style="${st}"`
              : `style="font-family:${family};${st}"`
        );
      }
      return `<${tag}${before}${cls} style="font-family:${family};"${after}>`;
    });
  }

  result = result.replace(/\sclass=""/g, "");
  return normalizeEmailSpacing(result);
}

function normalizeEmailSpacing(html: string): string {
  if (!html || !html.trim()) return html;
  let result = html;

  result = result.replace(
    /^<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:[^"]*color:#111;">([\s\S]*)<\/div>$/i,
    "$1"
  );

  result = result.replace(/<p[^>]*>\s*(<br\s*\/?>|&nbsp;|\s)*\s*<\/p>/gi, "");
  result = result.replace(/<div[^>]*>\s*(<br\s*\/?>|&nbsp;|\s)*\s*<\/div>/gi, "");
  result = result.replace(/(<br\s*\/?>\s*){3,}/gi, "<br/>");

  // p → div (Gmail gap fix)
  result = result.replace(/<p(\s[^>]*)?>/gi, "<div$1>");
  result = result.replace(/<\/p>/gi, "</div>");

  result = result.replace(
    /<(div|h1|h2|h3|h4|h5|h6|li|td|th)(\s[^>]*)?>/gi,
    (_m, tag, attrs = "") => {
      attrs = attrs || "";
      const base = "margin:0;padding:0;line-height:1.4;font-size:inherit;";
      if (/\sstyle\s*=\s*"/i.test(attrs)) {
        return `<${tag}${attrs}>`.replace(/style\s*=\s*"([^"]*)"/i, (_s, st) => {
          let s = st
            .replace(/margin\s*:[^;]*;?/gi, "")
            .replace(/padding\s*:[^;]*;?/gi, "")
            .replace(/line-height\s*:[^;]*;?/gi, "")
            .trim();
          return `style="${base}${s}"`;
        });
      }
      return `<${tag}${attrs} style="${base}">`;
    }
  );

  result = result.replace(/<ul(\s[^>]*)?>/gi, (full, attrs = "") =>
    /style\s*=/i.test(attrs || "") ? full : `<ul${attrs || ""} style="margin:0;padding-left:18px;">`
  );
  result = result.replace(/<ol(\s[^>]*)?>/gi, (full, attrs = "") =>
    /style\s*=/i.test(attrs || "") ? full : `<ol${attrs || ""} style="margin:0;padding-left:18px;">`
  );

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#111111;margin:0;padding:0;">${result}</div>`;
}
