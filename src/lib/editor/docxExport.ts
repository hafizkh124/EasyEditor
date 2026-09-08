/**
 * M10 Phase 2.6 — a REAL OOXML `.docx` exporter for the web build.
 *
 * exporters.ts's `exportDoc` used to send Word an HTML file with a `.doc`
 * extension and `application/msword` MIME type — Word opens it, but it is
 * not the OOXML format modern Word actually writes ("format mismatch"
 * warning), carries no real styles/footnotes, and is the one genuine
 * feature gap between the web export and desktop's Word-COM export (which
 * writes true `.docx`). This walks the editor's HTML into the `docx` npm
 * package's object model and packs a real `.docx` Blob instead.
 *
 * Lazy-loaded (`import("docx")`, ~350 KB) — the same pattern
 * src/lib/fonts/index.ts already uses for the Arabic font faces — so the
 * entry bundle does not grow for a feature only the Export menu's "Word"
 * option ever touches.
 *
 * Deliberately NOT a full HTML-to-OOXML converter: lists render as plain
 * "• "/"1. "-prefixed paragraphs rather than Word's native numbering
 * (skips docx's numbering-definition API — a real fidelity loss, but a
 * readable one), and anything not explicitly recognised below still
 * becomes a plain paragraph via the same fallback path a <p> would take —
 * never silently dropped, never a thrown export.
 */
import { isRtlDominant } from "~shared/text/scriptRuns";

type DocxModule = typeof import("docx");
// The docx package's own ParagraphChild/TableChild unions are not exported
// as a single reusable name; this repo's no-explicit-any rule is off
// project-wide (per the M10 Phase 5 audit), so this ambient alias is fine.
type DocxNode = any;

async function loadDocx(): Promise<DocxModule> {
  return import("docx");
}

/** FONT_CSS's class → real font name, for Word (which needs an installed
 *  font name, not a Google Fonts @import). Falls back to Word's own default
 *  when neither a recognised class nor an inline font-family is present. */
const FONT_CLASS_MAP: Record<string, string> = {
  "font-nastaliq": "Noto Nastaliq Urdu",
  "font-naskh": "Noto Naskh Arabic",
  "font-amiri": "Amiri",
  "font-quran": "Amiri Quran",
  "font-vazir": "Vazirmatn",
};

function fontFor(el: Element): string | undefined {
  for (const cls of Object.keys(FONT_CLASS_MAP)) {
    if (el.classList.contains(cls)) return FONT_CLASS_MAP[cls];
  }
  const inline = (el as HTMLElement).style?.fontFamily;
  if (inline) return inline.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
  return undefined;
}

function alignmentFor(el: Element, docx: DocxModule): (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType] | undefined {
  const style = (el as HTMLElement).style;
  const align = style?.textAlign || (el.getAttribute("style") ?? "").match(/text-align:\s*(\w+)/)?.[1];
  switch (align) {
    case "center": return docx.AlignmentType.CENTER;
    case "right": return docx.AlignmentType.RIGHT;
    case "left": return docx.AlignmentType.LEFT;
    case "justify": return docx.AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

interface RunState {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  superScript?: boolean;
  subScript?: boolean;
  font?: string;
}

/** Walk one inline node (text, mark element, <a>, <br>) into docx run(s), appended to `out`. */
function walkInline(node: ChildNode, state: RunState, docx: DocxModule, out: DocxNode[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) return;
    out.push(new docx.TextRun({
      text,
      bold: state.bold,
      italics: state.italics,
      underline: state.underline ? {} : undefined,
      strike: state.strike,
      superScript: state.superScript,
      subScript: state.subScript,
      rightToLeft: isRtlDominant(text),
      font: state.font,
    }));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    out.push(new docx.TextRun({ text: "", break: 1 }));
    return;
  }

  const next: RunState = { ...state, font: fontFor(el) ?? state.font };
  if (tag === "strong" || tag === "b") next.bold = true;
  if (tag === "em" || tag === "i") next.italics = true;
  if (tag === "u") next.underline = true;
  if (tag === "s" || tag === "strike" || tag === "del") next.strike = true;
  if (tag === "sup") next.superScript = true;
  if (tag === "sub") next.subScript = true;

  if (tag === "a") {
    const href = el.getAttribute("href");
    const children: DocxNode[] = [];
    for (const child of Array.from(el.childNodes)) walkInline(child, { ...next, underline: true }, docx, children);
    if (href && children.length) {
      out.push(new docx.ExternalHyperlink({ link: href, children }));
    } else {
      out.push(...children);
    }
    return;
  }

  for (const child of Array.from(el.childNodes)) walkInline(child, next, docx, out);
}

function runsFor(el: Element, docx: DocxModule, base: RunState = {}): DocxNode[] {
  const runs: DocxNode[] = [];
  const withFont: RunState = { ...base, font: fontFor(el) ?? base.font };
  for (const child of Array.from(el.childNodes)) walkInline(child, withFont, docx, runs);
  return runs.length ? runs : [new docx.TextRun({ text: "" })];
}

const HEADING_TAGS: Record<string, keyof DocxModule["HeadingLevel"]> = {
  h1: "HEADING_1", h2: "HEADING_2", h3: "HEADING_3", h4: "HEADING_4", h5: "HEADING_5", h6: "HEADING_6",
};

function paragraphFor(el: Element, docx: DocxModule, opts: { indent?: number; runState?: RunState } = {}): InstanceType<DocxModule["Paragraph"]> {
  const text = el.textContent ?? "";
  const rtl = isRtlDominant(text);
  const headingKey = HEADING_TAGS[el.tagName.toLowerCase()];
  return new docx.Paragraph({
    children: runsFor(el, docx, opts.runState),
    heading: headingKey ? docx.HeadingLevel[headingKey] : undefined,
    bidirectional: rtl,
    alignment: alignmentFor(el, docx) ?? (rtl ? docx.AlignmentType.RIGHT : docx.AlignmentType.LEFT),
    indent: opts.indent ? { start: opts.indent } : undefined,
  });
}

function tableToDocx(table: Element, docx: DocxModule): InstanceType<DocxModule["Table"]> {
  const rows: InstanceType<DocxModule["TableRow"]>[] = [];
  for (const tr of Array.from(table.querySelectorAll(":scope > tr, :scope > tbody > tr, :scope > thead > tr"))) {
    const cellEls = Array.from(tr.querySelectorAll(":scope > td, :scope > th"));
    const cells = cellEls.map((cellEl) => {
      const isHeader = cellEl.tagName.toLowerCase() === "th";
      return new docx.TableCell({
        children: [paragraphFor(cellEl, docx, { runState: { bold: isHeader } })],
        width: { size: Math.floor(100 / Math.max(1, cellEls.length)), type: docx.WidthType.PERCENTAGE },
      });
    });
    if (cells.length) rows.push(new docx.TableRow({ children: cells }));
  }
  if (rows.length === 0) rows.push(new docx.TableRow({ children: [new docx.TableCell({ children: [new docx.Paragraph({})] })] }));
  return new docx.Table({ rows, width: { size: 100, type: docx.WidthType.PERCENTAGE } });
}

/** One top-level block element -> one or more docx Paragraph/Table nodes. Never throws on an unrecognised tag — it just falls through to a plain paragraph. */
function blockToDocx(el: Element, docx: DocxModule): DocxNode[] {
  const tag = el.tagName.toLowerCase();

  if (tag === "table") return [tableToDocx(el, docx)];

  if (tag === "ul" || tag === "ol") {
    const out: DocxNode[] = [];
    let n = 1;
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      const prefix = tag === "ol" ? `${n}. ` : "• ";
      const rtl = isRtlDominant(li.textContent ?? "");
      const runs = runsFor(li, docx);
      const prefixRun = new docx.TextRun({ text: prefix, rightToLeft: rtl });
      out.push(new docx.Paragraph({
        children: [prefixRun, ...runs],
        bidirectional: rtl,
        alignment: rtl ? docx.AlignmentType.RIGHT : docx.AlignmentType.LEFT,
        indent: { start: 360 },
      }));
      n += 1;
    }
    return out;
  }

  if (tag === "blockquote") {
    return [paragraphFor(el, docx, { indent: 720, runState: { italics: true } })];
  }

  // p, div, h1-h6, and anything else not specifically handled — one paragraph.
  return [paragraphFor(el, docx)];
}

/**
 * Convert editor HTML into a real `.docx` Blob. `html` must already be
 * suggestion-stripped (exporters.ts's `exportDoc` does that before calling
 * in — this file does not import stripSuggestions itself, since exportDoc
 * dynamically imports THIS file, and a static import back would make the
 * two circular). Returns null (never throws) if the `docx` package cannot
 * be loaded or the conversion itself fails — the caller falls back to the
 * legacy `.doc`-via-HTML export in that case, so a scholar always gets a
 * working download either way.
 */
export async function htmlToDocxBlob(html: string, title: string): Promise<Blob | null> {
  try {
    const docx = await loadDocx();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const blocks: DocxNode[] = [];
    for (const child of Array.from(parsed.body.children)) {
      blocks.push(...blockToDocx(child, docx));
    }
    if (blocks.length === 0) {
      const text = (parsed.body.textContent ?? "").trim();
      blocks.push(new docx.Paragraph({
        children: [new docx.TextRun({ text, rightToLeft: isRtlDominant(text) })],
        bidirectional: isRtlDominant(text),
      }));
    }

    const doc = new docx.Document({
      title,
      styles: {
        default: {
          document: { run: { font: "Noto Naskh Arabic" } },
        },
      },
      sections: [{ properties: {}, children: blocks }],
    });
    return await docx.Packer.toBlob(doc);
  } catch {
    return null;
  }
}
