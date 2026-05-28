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
  .font-nastaliq { font-family: 'Noto Nastaliq Urdu', serif; }
  .font-naskh { font-family: 'Noto Naskh Arabic', 'Amiri', serif; }
  .font-amiri { font-family: 'Amiri', serif; }
  .font-quran { font-family: 'Amiri Quran', 'Amiri', serif; }
  .font-vazir { font-family: 'Vazirmatn', sans-serif; }
`;

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
    new Blob([buildHtmlDocument(title, html)], { type: "text/html;charset=utf-8" }),
    `${safeName(title)}.html`,
  );
}

/**
 * Word export. A `.doc` file is really just HTML with Word-specific headers and
 * the application/msword MIME type. Word opens it with all formatting, fonts,
 * and RTL direction preserved — no docx library required.
 */
export function exportDoc(html: string, title: string): void {
  const docHtml =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${title}</title>` +
    `<style>${FONT_CSS}</style></head>` +
    `<body dir="auto">${html}</body></html>`;
  triggerDownload(new Blob([docHtml], { type: "application/msword;charset=utf-8" }), `${safeName(title)}.doc`);
}

/**
 * PDF export via the browser's print engine. Opens a hidden print window with the
 * styled content and calls print(); the user picks "Save as PDF". This yields the
 * best Arabic/Urdu glyph shaping (the browser's text engine does it natively).
 */
export function exportPdf(html: string, title: string): void {
  const win = window.open("", "_blank", "width=820,height=1000");
  if (!win) return;
  win.document.write(buildHtmlDocument(title, html));
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
