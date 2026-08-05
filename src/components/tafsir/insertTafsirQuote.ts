/**
 * Tafsir quote insertion + attribution (SPEC-TAFSIR §FR-7).
 *
 * Builds the blockquote HTML (text + a citation/attribution footer) and pushes
 * it into the mounted editor via the insert bus; falls back to the clipboard
 * when no editor is open or on the web build. Every insertion carries an
 * attribution line so CC BY 4.0 content is never pasted bare.
 */
import { isRtlText } from "@/utils/textUtils";
import { escapeHtml } from "@/lib/editor/htmlText";
import { tryExternalInsert } from "@/lib/editor/insertBus";

export interface TafsirQuote {
  /** The exegesis / ayah text to insert. */
  text: string;
  /** Reference line, e.g. «البقرة 2:255». */
  reference: string;
  /** Source attribution, e.g. «تيسير الكريم الرحمن، السعدي». */
  source?: string;
  /** Extra license note appended when present, e.g. "مصدر: مركز تفسير (CC BY 4.0)". */
  licenseNote?: string;
}

/** Attribution body shown under the quote (mirrors the Shamela `<em>[..]</em>`). */
export function buildAttribution(q: TafsirQuote): string {
  const parts: string[] = [];
  if (q.source) parts.push(q.source);
  if (q.reference) parts.push(q.reference);
  if (q.licenseNote) parts.push(q.licenseNote);
  return parts.join(" — ");
}

/** HTML blockquote for the TipTap editor. */
export function buildQuoteHtml(q: TafsirQuote): string {
  const rtl = isRtlText(q.text) || /[\u0600-\u06FF]/.test(q.reference);
  const attr = buildAttribution(q);
  return (
    `<blockquote dir="${rtl ? "rtl" : "ltr"}">` +
    `<p>${escapeHtml(q.text)}</p>` +
    (attr ? `<p><em>[${escapeHtml(attr)}]</em></p>` : "") +
    `</blockquote><p></p>`
  );
}

/** Plain-text form used for the clipboard fallback / copy button. */
export function buildPlainText(q: TafsirQuote): string {
  const attr = buildAttribution(q);
  return q.text + (attr ? `\n\n[${attr}]` : "");
}

export type InsertOutcome = "inserted" | "copied" | "failed";

/**
 * Preferred path: insert into the mounted editor. When that is unavailable
 * (no editor open / web build), copy the plain text and report "copied".
 */
export async function insertTafsir(q: TafsirQuote): Promise<InsertOutcome> {
  const html = buildQuoteHtml(q);

  if (tryExternalInsert(html)) return "inserted";

  try {
    await navigator.clipboard.writeText(buildPlainText(q));
    return "copied";
  } catch {
    return "failed";
  }
}