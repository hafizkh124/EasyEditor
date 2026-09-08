/**
 * Document exporters for the Editor. Zero external deps — relies on the browser
 * and the OS-installed word processor / PDF engine for reliable Arabic/Urdu
 * shaping and RTL layout.
 *
 *  - exportTxt:  plain text Blob download (.txt)
 *  - exportHtml: standalone styled HTML document (.html)
 *  - exportDoc:  HTML wrapped with Word-compatible headers, saved as .doc
 *                (application/msword) — Word opens it with formatting + RTL.
 *  - exportPdf:  opens a styled print window and triggers window.print(), so the
 *                user can "Save as PDF" with correctly shaped script.
 */

/** Embedded font stack so exported files render Urdu/Arabic/Quran correctly even offline-ish. */
const FONT_CSS = `
  @import url("https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;500;600;700&family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Amiri:ital,wght@0,400;0,700;1,400;1,700&family=Amiri+Quran&family=Vazirmatn:wght@400;500;600;700&family=Lora:wght@400;500;600;700&family=Work+Sans:wght@400;500;600;700&display=swap");
  body { font-family: 'Work Sans', 'Noto Naskh Arabic', system-ui, sans-serif; line-height: 1.8; color: #1a1a1a; }
  h1, h2, h3 { font-family: 'Lora', 'Noto Naskh Arabic', serif; line-height: 1.4; }
  blockquote { border-inline-start: 3px solid #ccc; margin-inline-start: 0; padding-inline-start: 1rem; color: #444; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #999; padding: 0.5rem 0.75rem; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; text-align: start; }
  .font-nastaliq { font-family: 'Noto Nastaliq Urdu', serif; }
  .font-naskh { font-family: 'Noto Naskh Arabic', 'Amiri', serif; }
  .font-amiri { font-family: 'Amiri', serif; }
  .font-quran { font-family: 'Amiri Quran', 'Amiri', serif; }
  .font-vazir { font-family: 'Vazirmatn', sans-serif; }
`;

/**
 * Resolve track-changes suggestions to a clean document (accept-all implied):
 * drop deletion marks (`<del>`) entirely and unwrap insertion marks (`<ins>`),
 * keeping their text. Exported documents never contain raw suggestion markup.
 */
export function stripSuggestions(html: string): string {
  if (!html || (!html.includes("<del") && !html.includes("<ins"))) return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("del[data-change-id], del").forEach((el) => el.remove());
    doc.querySelectorAll("ins[data-change-id], ins").forEach((el) => {
      while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
      el.remove();
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function safeName(title: string): string {
  return (title || "document").replace(/[\\/:*?"<>|]/g, "_").trim() || "document";
}

/** Build a full standalone HTML document around the editor's body HTML. */
function buildHtmlDocument(title: string, bodyHtml: string): string {
  return (
    `<!DOCTYPE html><html dir="auto"><head><meta charset="utf-8">` +
    `<title>${title}</title>` +
    `<style>${FONT_CSS}\nbody{max-width:800px;margin:2rem auto;padding:0 1rem;}</style>` +
    `</head><body dir="auto">${bodyHtml}</body></html>`
  );
}

export function exportTxt(text: string, title: string): void {
  triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), `${safeName(title)}.txt`);
}

export function exportHtml(html: string, title: string): void {
  triggerDownload(
    new Blob([buildHtmlDocument(title, stripSuggestions(html))], { type: "text/html;charset=utf-8" }),
    `${safeName(title)}.html`,
  );
}

/**
 * Legacy Word export. A `.doc` file that is really just HTML with
 * Word-specific headers and the application/msword MIME type — Word opens
 * it with formatting + RTL preserved, but it is NOT real OOXML (a modern
 * Word shows a "format mismatch" warning, and there are no real styles or
 * footnotes). Superseded by `exportDoc`'s real `.docx` path (M10 Phase 2.6,
 * src/lib/editor/docxExport.ts) — kept only as that path's own fallback for
 * a release or two, in case the DOM-to-OOXML conversion ever hits an HTML
 * shape it does not handle.
 */
export function exportDocLegacy(html: string, title: string): void {
  const docHtml =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${FONT_CSS}</style></head>` +
    `<body dir="auto">${stripSuggestions(html)}</body></html>`;
  triggerDownload(new Blob([docHtml], { type: "application/msword;charset=utf-8" }), `${safeName(title)}.doc`);
}

/**
 * Word export. Real OOXML `.docx` via the `docx` npm package (lazy-loaded —
 * see docxExport.ts), not an HTML file wearing a `.doc` extension. Falls
 * back to `exportDocLegacy` if the conversion itself fails for any reason —
 * a scholar always gets a working download either way.
 */
export async function exportDoc(html: string, title: string): Promise<void> {
  const { htmlToDocxBlob } = await import("./docxExport");
  // Stripped once, here — docxExport.ts takes already-clean HTML so it has
  // no need to import back from this file (avoids a circular import between
  // the two, since this function itself dynamically imports docxExport.ts).
  const clean = stripSuggestions(html);
  const blob = await htmlToDocxBlob(clean, title);
  if (blob) {
    triggerDownload(blob, `${safeName(title)}.docx`);
    return;
  }
  exportDocLegacy(html, title);
}

/**
 * PDF export via the browser's print engine. Opens a hidden print window with the
 * styled content and calls print(); the user picks "Save as PDF". This yields the
 * best Arabic/Urdu glyph shaping (the browser's text engine does it natively).
 */
export function exportPdf(html: string, title: string): void {
  const win = window.open("", "_blank", "width=820,height=1000");
  if (!win) return;
  win.document.write(buildHtmlDocument(title, stripSuggestions(html)));
  win.document.close();
  win.focus();
  // Give fonts a moment to load before printing.
  win.onload = () => {
    setTimeout(() => {
      win.print();
    }, 400);
  };
  // Fallback if onload already fired.
  setTimeout(() => {
    try { win.print(); } catch { /* ignore */ }
  }, 800);
}
