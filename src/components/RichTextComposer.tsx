"use client";

import React, { useEffect, useRef } from "react";
import "quill/dist/quill.snow.css";

interface RichTextComposerProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Pull usable HTML from a full document or fragment */
function extractRenderableHtml(raw: string): string {
  if (!raw || !raw.trim()) return "";
  let html = raw.trim();

  // If full document, prefer body inner HTML
  try {
    if (
      typeof window !== "undefined" &&
      (html.includes("<html") || html.includes("<body") || html.includes("<!DOCTYPE"))
    ) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const body = doc.body;
      if (body && body.innerHTML.trim()) {
        html = body.innerHTML;
      }
    }
  } catch {
    /* keep raw */
  }

  // Strip scripts for safety
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/on\w+="[^"]*"/gi, "");
  html = html.replace(/on\w+='[^']*'/gi, "");

  return html.trim();
}

/**
 * Convert inline text-align styles → Quill alignment classes
 * so the editor shows center/right correctly when loading templates
 */
function convertInlineAlignToQuill(html: string): string {
  if (!html) return html;

  let result = html;

  // style="...text-align: center..." → class="ql-align-center"
  result = result.replace(
    /style="([^"]*?)text-align:\s*center;?([^"]*?)"/gi,
    (_match, before, after) => {
      const other = (before + after)
        .replace(/;+/g, ";")
        .replace(/^;|;$/g, "")
        .trim();
      if (other) {
        return `class="ql-align-center" style="${other}"`;
      }
      return `class="ql-align-center"`;
    }
  );

  result = result.replace(
    /style="([^"]*?)text-align:\s*right;?([^"]*?)"/gi,
    (_match, before, after) => {
      const other = (before + after)
        .replace(/;+/g, ";")
        .replace(/^;|;$/g, "")
        .trim();
      if (other) {
        return `class="ql-align-right" style="${other}"`;
      }
      return `class="ql-align-right"`;
    }
  );

  result = result.replace(
    /style="([^"]*?)text-align:\s*justify;?([^"]*?)"/gi,
    (_match, before, after) => {
      const other = (before + after)
        .replace(/;+/g, ";")
        .replace(/^;|;$/g, "")
        .trim();
      if (other) {
        return `class="ql-align-justify" style="${other}"`;
      }
      return `class="ql-align-justify"`;
    }
  );

  result = result.replace(
    /style="([^"]*?)text-align:\s*left;?([^"]*?)"/gi,
    (_match, before, after) => {
      const other = (before + after)
        .replace(/;+/g, ";")
        .replace(/^;|;$/g, "")
        .trim();
      if (other) {
        return `class="ql-align-left" style="${other}"`;
      }
      return `class="ql-align-left"`;
    }
  );

  return result;
}

/**
 * Gmail-style rich text composer (Quill).
 * Supports HTML paste (rendered content) + external HTML sync.
 */
export default function RichTextComposer({
  value = "",
  onChange,
  placeholder = "Compose your email message...",
  className = "",
}: RichTextComposerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  const lastHtmlRef = useRef(value);
  const applyingExternalRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!containerRef.current || quillRef.current) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    (async () => {
      const QuillMod = await import("quill");
      const Quill = QuillMod.default || QuillMod;

      // Font family
      const Font = Quill.import("formats/font") as any;
      Font.whitelist = [
        "arial",
        "helvetica",
        "times-new-roman",
        "georgia",
        "verdana",
        "courier-new",
        "tahoma",
        "trebuchet-ms",
        "garamond",
        "comic-sans-ms",
      ];
      Quill.register(Font, true);

      // Font size
      const Size = Quill.import("formats/size") as any;
      Size.whitelist = [
        "10px",
        "12px",
        "14px",
        "16px",
        "18px",
        "20px",
        "24px",
        "28px",
        "32px",
      ];
      Quill.register(Size, true);

      // Image embed for paste support
      try {
        const Image = Quill.import("formats/image");
        Quill.register(Image as any, true);
      } catch {
        /* already registered */
      }

      if (cancelled || !containerRef.current) return;

      containerRef.current.innerHTML = "";
      const editorEl = document.createElement("div");
      containerRef.current.appendChild(editorEl);

      const quill = new Quill(editorEl, {
        theme: "snow",
        placeholder,
        modules: {
          toolbar: [
            [
              {
                font: [
                  "arial",
                  "helvetica",
                  "times-new-roman",
                  "georgia",
                  "verdana",
                  "courier-new",
                  "tahoma",
                  "trebuchet-ms",
                  "garamond",
                  "comic-sans-ms",
                ],
              },
            ],
            [
              {
                size: [
                  "10px",
                  "12px",
                  "14px",
                  "16px",
                  "18px",
                  "20px",
                  "24px",
                  "28px",
                  "32px",
                ],
              },
            ],
            [{ header: [1, 2, 3, 4, false] }],
            ["bold", "italic", "underline", "strike"],
            [{ color: [] }, { background: [] }],
            [{ list: "ordered" }, { list: "bullet" }],
            [{ indent: "-1" }, { indent: "+1" }],
            [{ align: [] }],
            ["blockquote", "code-block"],
            ["link", "image"],
            ["clean"],
          ],
          clipboard: {
            matchVisual: false,
          },
        },
        formats: [
          "font",
          "size",
          "header",
          "bold",
          "italic",
          "underline",
          "strike",
          "color",
          "background",
          "list",
          "indent",
          "align",
          "blockquote",
          "code-block",
          "link",
          "image",
        ],
      });

      // --- Custom paste: keep HTML formatting (not plain text) ---
      const root = quill.root as HTMLElement;
      root.addEventListener(
        "paste",
        (e: ClipboardEvent) => {
          const cd = e.clipboardData;
          if (!cd) return;

          const htmlData = cd.getData("text/html");
          if (htmlData && htmlData.trim()) {
            e.preventDefault();
            e.stopPropagation();

            let cleaned = extractRenderableHtml(htmlData);
            cleaned = convertInlineAlignToQuill(cleaned);

            const range = quill.getSelection(true);
            const index = range ? range.index : quill.getLength();

            applyingExternalRef.current = true;
            try {
              quill.clipboard.dangerouslyPasteHTML(index, cleaned, "user");
            } catch {
              quill.clipboard.dangerouslyPasteHTML(cleaned);
            }
            applyingExternalRef.current = false;

            const out = quill.root.innerHTML;
            lastHtmlRef.current = out;
            onChangeRef.current?.(out);
            return;
          }

          // If only plain text but looks like HTML tags, treat as HTML
          const plain = cd.getData("text/plain") || "";
          if (
            plain &&
            /<\/?[a-z][\s\S]*>/i.test(plain) &&
            (plain.includes("<div") ||
              plain.includes("<p") ||
              plain.includes("<table") ||
              plain.includes("<span") ||
              plain.includes("<br"))
          ) {
            e.preventDefault();
            e.stopPropagation();
            let cleaned = extractRenderableHtml(plain);
            cleaned = convertInlineAlignToQuill(cleaned);
            const range = quill.getSelection(true);
            const index = range ? range.index : quill.getLength();
            applyingExternalRef.current = true;
            quill.clipboard.dangerouslyPasteHTML(index, cleaned, "user");
            applyingExternalRef.current = false;
            const out = quill.root.innerHTML;
            lastHtmlRef.current = out;
            onChangeRef.current?.(out);
          }
        },
        true
      );

      const setHtmlIntoEditor = (raw: string) => {
        let cleaned = extractRenderableHtml(raw);
        cleaned = convertInlineAlignToQuill(cleaned); // ← important for alignment

        applyingExternalRef.current = true;
        try {
          const len = quill.getLength();
          quill.deleteText(0, len, "silent");
          if (cleaned) {
            quill.clipboard.dangerouslyPasteHTML(0, cleaned, "silent");
          }
        } catch {
          quill.root.innerHTML = cleaned || "";
        }
        applyingExternalRef.current = false;
        lastHtmlRef.current = quill.root.innerHTML || cleaned;
      };

      if (value) {
        setHtmlIntoEditor(value);
      }

      quill.on("text-change", () => {
        if (applyingExternalRef.current) return;
        const html = quill.root.innerHTML;
        const normalized =
          html === "<p><br></p>" || html === "<p><br/></p>" ? "" : html;
        lastHtmlRef.current = normalized;
        onChangeRef.current?.(normalized);
      });

      // expose helper for external sync
      (quill as any).__setHtml = setHtmlIntoEditor;

      quillRef.current = quill;
    })();

    return () => {
      cancelled = true;
      quillRef.current = null;
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value → editor (HTML Code Block / template)
  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) return;
    const incoming = value || "";
    const current = quill.root.innerHTML || "";
    const norm = (h: string) =>
      h.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();

    if (norm(incoming) === norm(current) || incoming === lastHtmlRef.current) {
      return;
    }

    if (typeof (quill as any).__setHtml === "function") {
      (quill as any).__setHtml(incoming);
    } else {
      let cleaned = extractRenderableHtml(incoming);
      cleaned = convertInlineAlignToQuill(cleaned);
      applyingExternalRef.current = true;
      try {
        const len = quill.getLength();
        quill.deleteText(0, len, "silent");
        if (cleaned) quill.clipboard.dangerouslyPasteHTML(0, cleaned, "silent");
      } catch {
        quill.root.innerHTML = cleaned || "";
      }
      applyingExternalRef.current = false;
      lastHtmlRef.current = quill.root.innerHTML || cleaned;
    }
  }, [value]);

  return (
    <div className={`rich-text-composer-wrapper ${className}`}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .rich-text-composer-wrapper .ql-container {
          min-height: 240px;
          font-size: 14px;
          font-family: Arial, Helvetica, sans-serif;
          border-bottom-left-radius: 0.5rem;
          border-bottom-right-radius: 0.5rem;
          background: #fff;
          color: #111;
        }
        .rich-text-composer-wrapper .ql-editor {
          min-height: 240px;
          line-height: 1.6;
        }
        .rich-text-composer-wrapper .ql-editor img {
          max-width: 100%;
          height: auto;
        }
        .rich-text-composer-wrapper .ql-editor.ql-blank::before {
          color: #9ca3af;
          font-style: normal;
        }
        .rich-text-composer-wrapper .ql-toolbar {
          border-top-left-radius: 0.5rem;
          border-top-right-radius: 0.5rem;
          background: #f8fafc;
          border-color: #d1d5db;
          flex-wrap: wrap;
        }
        .rich-text-composer-wrapper .ql-container {
          border-color: #d1d5db;
        }

        /* ===== Alignment fix (important) ===== */
        .ql-editor .ql-align-center {
          text-align: center !important;
        }
        .ql-editor .ql-align-right {
          text-align: right !important;
        }
        .ql-editor .ql-align-justify {
          text-align: justify !important;
        }
        .ql-editor .ql-align-left {
          text-align: left !important;
        }

        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="arial"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="arial"]::before {
          content: "Arial"; font-family: Arial, sans-serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="helvetica"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="helvetica"]::before {
          content: "Helvetica"; font-family: Helvetica, sans-serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="times-new-roman"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="times-new-roman"]::before {
          content: "Times New Roman"; font-family: "Times New Roman", Times, serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="georgia"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="georgia"]::before {
          content: "Georgia"; font-family: Georgia, serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="verdana"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="verdana"]::before {
          content: "Verdana"; font-family: Verdana, sans-serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="courier-new"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="courier-new"]::before {
          content: "Courier New"; font-family: "Courier New", monospace;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="tahoma"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="tahoma"]::before {
          content: "Tahoma"; font-family: Tahoma, sans-serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="trebuchet-ms"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="trebuchet-ms"]::before {
          content: "Trebuchet MS"; font-family: "Trebuchet MS", sans-serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="garamond"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="garamond"]::before {
          content: "Garamond"; font-family: Garamond, serif;
        }
        .ql-snow .ql-picker.ql-font .ql-picker-label[data-value="comic-sans-ms"]::before,
        .ql-snow .ql-picker.ql-font .ql-picker-item[data-value="comic-sans-ms"]::before {
          content: "Comic Sans MS"; font-family: "Comic Sans MS", cursive;
        }

        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="10px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="10px"]::before {
          content: "10px"; font-size: 10px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="12px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="12px"]::before {
          content: "12px"; font-size: 12px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="14px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="14px"]::before {
          content: "14px"; font-size: 14px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="16px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="16px"]::before {
          content: "16px"; font-size: 16px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="18px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="18px"]::before {
          content: "18px"; font-size: 18px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="20px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="20px"]::before {
          content: "20px"; font-size: 20px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="24px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="24px"]::before {
          content: "24px"; font-size: 24px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="28px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="28px"]::before {
          content: "28px"; font-size: 28px;
        }
        .ql-snow .ql-picker.ql-size .ql-picker-label[data-value="32px"]::before,
        .ql-snow .ql-picker.ql-size .ql-picker-item[data-value="32px"]::before {
          content: "32px"; font-size: 32px;
        }
      `,
        }}
      />
      <div ref={containerRef} />
    </div>
  );
}
