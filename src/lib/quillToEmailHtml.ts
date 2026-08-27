/**
 * Convert Quill editor classes to inline styles so Gmail/Outlook/preview keep alignment.
 */
export function quillToEmailHtml(html: string): string {
  if (!html || !html.trim()) return html;

  let result = html;

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
        out = out.replace(
          /style="([^"]*)"/i,
          (_sm: string, styles: string) => {
            if (/text-align\s*:/i.test(styles)) return `style="${styles}"`;
            return `style="text-align: ${align}; ${styles}"`;
          }
        );
        out = out.replace(
          /style='([^']*)'/i,
          (_sm: string, styles: string) => {
            if (/text-align\s*:/i.test(styles)) return `style='${styles}'`;
            return `style='text-align: ${align}; ${styles}'`;
          }
        );
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
        out = out.replace(
          /style="([^"]*)"/i,
          (_sm: string, styles: string) => {
            if (/font-size\s*:/i.test(styles)) return `style="${styles}"`;
            return `style="font-size: ${size}; ${styles}"`;
          }
        );
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
        out = out.replace(
          /style="([^"]*)"/i,
          (_sm: string, styles: string) => {
            if (/font-family\s*:/i.test(styles)) return `style="${styles}"`;
            return `style="font-family: ${family}; ${styles}"`;
          }
        );
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
        out = out.replace(
          /style="([^"]*)"/i,
          (_sm: string, styles: string) => {
            if (/margin-left\s*:/i.test(styles)) return `style="${styles}"`;
            return `style="margin-left: ${margin}; ${styles}"`;
          }
        );
        return out.replace(/\sclass=""/, "");
      }
      const clsAttr = restClass ? ` class="${restClass}"` : "";
      return `<${tag}${before}${clsAttr} style="margin-left: ${margin};"${after}>`;
    }
  );

  result = result.replace(/\sclass=""/g, "").replace(/\sclass=''/g, "");
  return result;
}