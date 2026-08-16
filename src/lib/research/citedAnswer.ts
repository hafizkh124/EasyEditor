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

/**
 * Every [N] (or [N, M, ...]) marker in the answer body, deduped and sorted —
 * the set of RETRIEVED SOURCES indices the model actually leaned on. Only
 * these get listed: `citations` also holds every source that was merely
 * offered as context but never cited, and listing all of them would imply
 * the answer relied on sources it never mentioned.
 */
function citedIndices(markdown: string): number[] {
  const nums = new Set<number>();
  for (const m of markdown.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of m[1].split(",")) nums.add(Number(part.trim()));
  }
  return [...nums].sort((a, b) => a - b);
}

export function buildReferencesMarkdown(markdown: string, citations: CitationItem[], t: Translator): string {
  if (citations.length === 0) return "";
  const indices = citedIndices(markdown).filter((n) => n >= 1 && n <= citations.length);
  if (indices.length === 0) return "";
  const lines = indices.map((n, i) => {
    const c = citations[n - 1];
    const label = formatCitation(c.domain, c.citation_ref);
    const url = c.url ?? c.citation_ref.url;
    return url ? `${i + 1}. [${label}](${url})` : `${i + 1}. ${label}`;
  });
  const heading = t("research.references_heading", "📚 حوالہ جات / References");
  return `\n\n## ${heading}\n${lines.join("\n")}`;
}

/**
 * Full replacement for an Islamic-mode answer's references: strips whatever
 * the model wrote (if anything) and appends a list built only from the [N]
 * markers actually present in the body, resolved against verified data. A
 * no-op for non-Islamic messages, since `citations` is empty for those.
 */
export function renderCitedAnswer(markdown: string, citations: CitationItem[], t: Translator): string {
  if (citations.length === 0) return markdown;
  const stripped = stripModelReferences(markdown);
  return stripped + buildReferencesMarkdown(stripped, citations, t);
}
