/**
 * M9 ADR-0021 — bounded generative templates for `draft_section`.
 *
 * SPEC-M8 §7 forbids the agent improvising a free-form generation prompt. This
 * reconciles substantial drafting with that rule the same way `refineText.ts`
 * reconciles the 12 fixed text tasks: a CLOSED set of instruction templates,
 * keyed by `mode`. The caller passes only `{mode}` — never a prompt.
 *
 * `grounded` modes must be given retrieved sources; the tool errors otherwise
 * (the same shape as insert_footnote's ledger gate).
 *
 * Pure — no runtime globals.
 */

export type DraftMode = 'outline' | 'prose' | 'column' | 'translation' | 'summary' | 'literary-urdu';

export interface DraftModeSpec {
  /** The fixed system instruction for this mode. */
  instruction: string;
  /** true ⇒ the model must be given retrieved source excerpts. */
  grounded: boolean;
  /** true ⇒ output is an HTML fragment; false ⇒ plain text. */
  html: boolean;
}

const COMMON_TAIL = `
Every factual claim, quotation, ruling, or attribution must come from the SOURCE EXCERPTS provided — never from your own memory. If the excerpts do not support a point, leave it out; do not fill the gap.
Keep quoted Qur'anic verses and hadith text verbatim as they appear in the excerpts.
Preserve the working language and script (Urdu stays Urdu Nastaliq, Arabic stays Arabic, English stays English).
Output ONLY the drafted text — no commentary, no markdown fences, no preamble.`;

export const DRAFT_MODES: Record<DraftMode, DraftModeSpec> = {
  outline: {
    grounded: false,
    html: true,
    instruction: `You are an academic research supervisor. Produce a structured chapter/section OUTLINE for the given topic: a hierarchy of headings and sub-headings (<h2>/<h3>/<ul>) with a one-line note under each on what it should cover and which kind of source establishes it. Do not write the prose itself. Preserve the working language and script. Output ONLY the HTML fragment — no commentary, no markdown fences.`,
  },
  prose: {
    grounded: true,
    html: true,
    instruction: `You are a careful scholarly author writing one section of a book chapter in measured academic prose. Build the argument only from the SOURCE EXCERPTS provided. Where a sentence rests on a specific source, end it with a bare marker [1], [2], … in order of first use — the citations are inserted separately. Output a clean HTML fragment (<p>, <h3>, <blockquote>).${COMMON_TAIL}`,
  },
  column: {
    grounded: false,
    html: true,
    instruction: `You are an accomplished Urdu columnist and essayist (کالم نگار). Write a fluent, literary opinion column on the given subject — an engaging opening, a clear line of thought, a considered close. Eloquent but not florid. If SOURCE EXCERPTS are provided, ground any factual claim or quotation in them and mark it [1], [2], …; otherwise keep to analysis and general knowledge and make no specific factual attributions. Output an HTML fragment. Preserve the working language and script. Output ONLY the column — no commentary, no markdown fences.`,
  },
  translation: {
    grounded: true,
    html: true,
    instruction: `You are an academic translator producing an idiomatic, faithful book translation. Translate the SOURCE EXCERPTS into the target language given in the instruction, keeping technical and religious terms consistent throughout (build and follow a term-base). Where a rendering is contested or a term is left transliterated, add a brief translator's note as a marker [1], [2], … Output an HTML fragment with the translation; keep the structure of the source.${COMMON_TAIL}`,
  },
  summary: {
    grounded: false,
    html: true,
    instruction: `You are an expert academic summarizer. Produce a clear, faithful summary of the given text or section at roughly 20-30% length, as flowing prose. Do not add information not in the source. Do not quote Qur'an or hadith from memory. Preserve the working language and script. Output ONLY the summary as an HTML fragment — no commentary, no markdown fences, no "Summary:" preamble.`,
  },
  // NOT grounded: this mode RECASTS text the chapter already holds (a lecture
  // transcript, a rough draft) rather than composing from retrieved sources, so
  // requiring source_ids would block the very use case it exists for. The
  // anti-invention guarantee comes from the instruction instead: every idea must
  // already be in the material (M9 Phase 5, ADR-0021).
  'literary-urdu': {
    grounded: false,
    html: true,
    instruction: `You are a distinguished Urdu prose stylist preparing a book chapter from a raw transcript or rough draft. Recast the CURRENT CHAPTER TEXT into polished, dignified literary Urdu (ادبی اردو) — correct register, natural rhythm, proper connectives, paragraphs that carry one idea each — and organise it under clear headings.

HARD RULES:
1. Every idea, ruling, quotation, and attribution must ALREADY be in the material you were given. Do not add facts, examples, hadith, verses, or names of your own.
2. Do not omit a point the speaker made; this is a recasting, not a summary.
3. Keep quoted Qur'anic verses and hadith text verbatim; only the surrounding prose is restyled.
4. Strip the artefacts of speech — false starts, repetitions, filler, asides to the audience.
5. Where a point plainly rests on a specific source, end that sentence with a bare marker [1], [2], … in order of first use, so citations can be attached afterwards. Never write the reference text yourself.
6. Preserve the working language and script (Urdu stays Urdu Nastaliq, Arabic quotations stay Arabic).
7. Output ONLY a clean HTML fragment (<h2>, <h3>, <p>, <blockquote>) — no commentary, no markdown fences.`,
  },
};

export function getDraftMode(mode: string): DraftModeSpec | undefined {
  return (DRAFT_MODES as Record<string, DraftModeSpec>)[mode];
}

export const DRAFT_MODE_NAMES = Object.keys(DRAFT_MODES) as DraftMode[];

/**
 * Build the user-content block for a draft call: the fixed instruction is the
 * systemInstruction; this is the data. `sources` is the retrieved-excerpt list
 * (already resolved through the ledger by the caller).
 */
export function buildDraftInput(opts: {
  mode: DraftMode;
  sectionHeading?: string;
  targetLanguage?: string;
  chapterExcerpt?: string;
  sources?: Array<{ marker: string; reference: string; excerpt: string }>;
}): string {
  const parts: string[] = [];
  if (opts.sectionHeading) parts.push(`SECTION: ${opts.sectionHeading}`);
  if (opts.targetLanguage) parts.push(`TARGET LANGUAGE: ${opts.targetLanguage}`);
  if (opts.chapterExcerpt) parts.push(`CURRENT CHAPTER TEXT (for context / continuity):\n${opts.chapterExcerpt}`);
  if (opts.sources?.length) {
    parts.push(
      'SOURCE EXCERPTS (the ONLY basis for factual content; the marker is the citation number):\n' +
        opts.sources.map((s) => `[${s.marker}] ${s.reference}\n${s.excerpt}`).join('\n\n'),
    );
  }
  return parts.join('\n\n');
}
