/**
 * M8 P6 — turn EasyEditor's citation output into Word footnote instructions,
 * reusing the web citation-integrity gate (SPEC-M8 §5 P6).
 *
 * The `citations` task returns body text with `[N]` index markers plus a
 * verified `sources` array; the reference *text* is never the model's — it is
 * rendered from `sources[N-1]`. `src/lib/editor/citationFormat.ts`'s
 * `rebuildCitedRefinement` applies that rule for the on-screen Sources list;
 * this applies the exact same rule to produce footnote text for a `.docx`.
 *
 * Pure — under shared/, no runtime globals (scripts/check-shared-purity.mjs).
 */

export interface FootnoteSource {
  /** The verified, app-rendered reference line (e.g. "Sahih Bukhari #123 (sahih)"). */
  reference: string;
  source_url?: string | null;
}

export interface CitationFootnote {
  /** The literal marker in the document, e.g. "[1]". */
  marker: string;
  /** The footnote body — built from the verified source, never model text. */
  text: string;
}

export interface BuildResult {
  /** One entry per distinct in-range `[N]` marker, in order of first appearance. */
  footnotes: CitationFootnote[];
  /** `[N]` markers found in the text whose N has no matching source. */
  unresolved: number[];
}

const MARKER_RE = /\[(\d+)\]/g;

/**
 * Pair every `[N]` marker in `documentText` with the verified `sources[N-1]`.
 * A marker whose N is out of range is reported in `unresolved` and produces
 * no footnote — the caller decides whether to refuse or proceed (P6's
 * adapter refuses if nothing resolves).
 */
export function buildCitationFootnotes(
  documentText: string,
  sources: FootnoteSource[],
): BuildResult {
  const seen = new Set<number>();
  const footnotes: CitationFootnote[] = [];
  const unresolved: number[] = [];

  for (const m of documentText.matchAll(MARKER_RE)) {
    const n = Number(m[1]);
    if (seen.has(n)) continue;
    seen.add(n);

    if (n < 1 || n > sources.length) {
      unresolved.push(n);
      continue;
    }
    const s = sources[n - 1];
    const ref = (s.reference || '').trim();
    if (!ref) {
      unresolved.push(n);
      continue;
    }
    footnotes.push({
      marker: `[${n}]`,
      text: s.source_url ? `${ref} — ${s.source_url}` : ref,
    });
  }

  return { footnotes, unresolved };
}
