/**
 * Convert Quill classes → inline styles for Gmail/Outlook.
 * Preserve exact spacing as typed in editor (no chipakna).
 */

export function quillToEmailHtml(html: string): string {
  if (!html || !html.trim()) return html;

  let result = html;

  // Already converted → skip
  if (result.includes('data-ea-converted="1"')) {
    return result;
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

  // Blank line (Enter Enter) → visible spacer — DELETE mat karo
  result = result.replace(
    /<p([^>]*)>\s*(?:<br\s*\/?>|&nbsp;|\s)*\s*<\/p>/gi,
    '<p$1 style="margin:0 0 14px 0;padding:0;line-height:1.6;font-size:14px;">&nbsp;</p>'
  );

  // Har paragraph / block pe clear gap
  const blocks = ["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li"];
  for (const tag of blocks) {
    const re = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
    result = result.replace(re, (full, attrs = "") => {
      attrs = attrs || "";
      const base =
        tag === "p" || tag === "div"
          ? "margin:0 0 14px 0;padding:0;line-height:1.6;"
          : tag.startsWith("h")
            ? "margin:0 0 16px 0;padding:0;line-height:1.4;"
            : "margin:0 0 8px 0;padding:0;line-height:1.6;";

      if (/\sstyle\s*=\s*"/i.test(attrs)) {
        return full.replace(/style\s*=\s*"([^"]*)"/i, (_m, styles) => {
          let s = styles.trim();
          if (!/margin\s*:/i.test(s)) s = "margin:0 0 14px 0; " + s;
          if (!/padding\s*:/i.test(s)) s = "padding:0; " + s;
          if (!/line-height\s*:/i.test(s)) s = "line-height:1.6; " + s;
          return `style="${s}"`;
        });
      }
      if (/\sstyle\s*=\s*'/i.test(attrs)) {
        return full.replace(/style\s*=\s*'([^']*)'/i, (_m, styles) => {
          let s = styles.trim();
          if (!/margin\s*:/i.test(s)) s = "margin:0 0 14px 0; " + s;
          if (!/padding\s*:/i.test(s)) s = "padding:0; " + s;
          if (!/line-height\s*:/i.test(s)) s = "line-height:1.6; " + s;
          return `style='${s}'`;
        });
      }
      return `<${tag}${attrs} style="${base}">`;
    });
  }

  result = result.replace(/<ul(\s[^>]*)?>/gi, (full, attrs = "") => {
    attrs = attrs || "";
    if (/style\s*=/i.test(attrs)) return full;
    return `<ul${attrs} style="margin:0 0 14px 0;padding-left:22px;line-height:1.6;">`;
  });
  result = result.replace(/<ol(\s[^>]*)?>/gi, (full, attrs = "") => {
    attrs = attrs || "";
    if (/style\s*=/i.test(attrs)) return full;
    return `<ol${attrs} style="margin:0 0 14px 0;padding-left:22px;line-height:1.6;">`;
  });

  // <br> keep — collapse mat karo
  result = `<div data-ea-converted="1" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#111111;">${result}</div>`;

  return result;
}
