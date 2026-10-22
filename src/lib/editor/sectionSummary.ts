import { escapeHtml, markdownToHtml } from "./htmlText";
// One label and heading rule with the desktop agent's section summaries.
import { summaryLabel, withoutOwnHeading } from "~shared/agent/sectionSummaries";

/**
 * The block a section summary is inserted as: a quote headed "خلاصہ" (or the
 * Arabic / English word, by the summary's own script), so it reads as an
 * addition to the section rather than part of the author's text.
 */

export { summaryLabel };

export function sectionSummaryHtml(output: string): string {
  const body = withoutOwnHeading(output.trim());
  return `<blockquote><p><strong>${escapeHtml(summaryLabel(body))}</strong></p>${markdownToHtml(body)}</blockquote>`;
}
