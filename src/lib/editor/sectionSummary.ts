import { escapeHtml, markdownToHtml } from "./htmlText";

/**
 * The block a section summary is inserted as: a quote headed "خلاصہ" (or the
 * Arabic / English word, by the summary's own script), so it reads as an
 * addition to the section rather than part of the author's text.
 */

const URDU_LETTERS = /[ٹڈڑںےہھپچژگک]/;
const ARABIC_SCRIPT = /[؀-ۿ]/;

export function summaryLabel(text: string): string {
  if (URDU_LETTERS.test(text)) return "خلاصہ";
  if (ARABIC_SCRIPT.test(text)) return "خلاصة";
  return "Summary";
}

/** Strip a leading "Summary:"-style line the model sometimes adds anyway. */
function withoutOwnHeading(text: string): string {
  return text.replace(/^\s*(?:#+\s*)?(?:\*\*)?(?:خلاصہ|خلاصة|الخلاصة|ملخص|Summary)(?:\*\*)?\s*[:：۔]?\s*\n+/i, "");
}

export function sectionSummaryHtml(output: string): string {
  const body = withoutOwnHeading(output.trim());
  return `<blockquote><p><strong>${escapeHtml(summaryLabel(body))}</strong></p>${markdownToHtml(body)}</blockquote>`;
}
