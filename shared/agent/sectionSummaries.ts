/**
 * Section summaries (SYSTEM-2026 §7): a short summary added under each
 * section of a chapter, the author's text left as it is. Shared by the editor
 * (src/components/editor/useChunkedRuns.ts) and the desktop agent's
 * `run_task section-summaries` (electron/agent/dispatch.ts), so both label
 * and shape the summary alike.
 *
 * Pure string work — the agent runs in the main process, with no DOM.
 */

/** Sections shorter than this (characters of text) are not worth a summary. */
export const MIN_SECTION_CHARS = 200;

const URDU_LETTERS = /[ٹڈڑںےہھپچژگک]/;
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** "خلاصہ", "خلاصة" or "Summary" — by the summary's own script. */
export function summaryLabel(text: string): string {
  if (URDU_LETTERS.test(text)) return "خلاصہ";
  if (ARABIC_SCRIPT.test(text)) return "خلاصة";
  return "Summary";
}

/** Strip a leading "Summary:"-style line the model sometimes adds anyway. */
export function withoutOwnHeading(text: string): string {
  // The colon may sit inside the bold ("**Summary:**") or after it ("**Summary**:").
  return text.replace(/^\s*(?:#+\s*)?(?:\*\*)?(?:خلاصہ|خلاصة|الخلاصة|ملخص|Summary)\s*[:：۔]?\s*(?:\*\*)?\s*[:：۔]?\s*\n+/i, "");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** The visible text of an HTML fragment. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The summary as an HTML block: a quote headed by the label, bullets kept. */
export function summaryBlockHtml(output: string): string {
  const body = withoutOwnHeading(output.trim());
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const inner = blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.every((l) => /^[-*•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^[-*•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
  return `<blockquote><p><strong>${escapeHtml(summaryLabel(body))}</strong></p>${inner}</blockquote>`;
}

export interface HtmlSection {
  /** The section's HTML, its heading first (the part before the first heading has none). */
  html: string;
  text: string;
}

/** Split a chapter's HTML at each h1–h3, the way the editor's planner does. */
export function splitHtmlSections(html: string): HtmlSection[] {
  const parts = html.split(/(?=<h[1-3][\s>])/i).filter((p) => p.trim());
  return parts.map((part) => ({ html: part, text: htmlToText(part) }));
}

/**
 * The chapter with each summary inserted after its section. `summaries` lines
 * up with `sections`; null leaves a section without one.
 */
export function withSectionSummaries(sections: readonly HtmlSection[], summaries: ReadonlyArray<string | null>): string {
  return sections
    .map((s, i) => {
      const summary = summaries[i]?.trim();
      return summary ? `${s.html}${summaryBlockHtml(summary)}` : s.html;
    })
    .join("");
}
