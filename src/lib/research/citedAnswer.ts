/**
 * Renders an Islamic-mode assistant answer with a References section built
 * from verified data instead of the model's own free-typed one.
 *
 * Why this exists: the model used to write BOTH the inline citations in its
 * answer text AND a "📚 حوالہ جات / References" list at the end, generating
 * both from the same retrieved-sources context in one pass. Because neither
 * was a copy of the other — just two separate free-text renderings of the
 * same underlying data — they could (and did) disagree, e.g. "Hadith 3" in
 * the body vs "Hadith 5251" in the list. The system prompt (islamic-search)
 * now asks the model to cite only by [N] index number and to stop writing a
 * references section at all; this module supplies that section itself, from
 * the same `citations` array the client already has from the `sources_ready`
 * SSE event — so the number a reader sees is always the one that was
 * actually retrieved, never a re-typed guess.
 */
import type { CitationItem } from "@/components/research/CitationPanel";
import { formatCitation } from "@/components/research/CitationBadge";
import type { Translator } from "@/lib/i18n";

// Matches the model's own references heading, in case it writes one despite
// being told not to (older cached answers, or an instruction slip). Cuts
// from that heading to the end of the string — the heading is always the
// last section per the system prompt's ANSWER STRUCTURE.
const REFERENCES_HEADING_RE = /\n#{1,4}[^\n]*(?:حوالہ جات|References)[^\n]*\n[\s\S]*$/i;

export function stripModelReferences(markdown: string): string {
  return markdown.replace(REFERENCES_HEADING_RE, "").trimEnd();
}

export function buildReferencesMarkdown(citations: CitationItem[], t: Translator): string {
  if (citations.length === 0) return "";
  const lines = citations.map((c, i) => {
    const label = formatCitation(c.domain, c.citation_ref);
    const url = c.url ?? c.citation_ref.url;
    return url ? `${i + 1}. [${label}](${url})` : `${i + 1}. ${label}`;
  });
  const heading = t("research.references_heading", "📚 حوالہ جات / References");
  return `\n\n## ${heading}\n${lines.join("\n")}`;
}

/**
 * Full replacement for an Islamic-mode answer's references: strips whatever
 * the model wrote (if anything) and appends the verified list. A no-op for
 * non-Islamic messages, since `citations` is empty for those.
 */
export function renderCitedAnswer(markdown: string, citations: CitationItem[], t: Translator): string {
  if (citations.length === 0) return markdown;
  return stripModelReferences(markdown) + buildReferencesMarkdown(citations, t);
}
