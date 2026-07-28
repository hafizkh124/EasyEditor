/**
 * Retrieval-window rules for citation lookups (SPEC-M3 FR-4.2).
 *
 * Pure functions with no Deno or network dependencies, so the vitest suite in
 * `src/test/retrievalQuery.test.ts` imports these exact definitions rather than
 * a copy — the "quotation at character 7,000" exit criterion is only meaningful
 * if the test exercises the code that actually ships.
 */

/**
 * Build the query the citation engine should search with.
 *
 * `refine-text` used to send `text.slice(0, 4000)`, so on a long passage the
 * engine only ever saw the opening: an ayah quoted at character 7,000 was
 * invisible and came back uncited. Widening the slice is not the fix either —
 * the engine is a hybrid lexical+semantic retriever, and burying the salient
 * terms in 12,000 characters of prose makes the query worse, not better.
 *
 * So the query is assembled from the parts that carry citable material: every
 * Arabic-script run long enough to be a quotation, then the head and tail of the
 * passage for topical context.
 */
/**
 * Letters that exist in Urdu but not in Arabic. A sentence containing any of
 * these is Urdu prose, not a quoted ayah or hadith.
 *
 * "Arabic script" alone cannot separate the two — Urdu *is* written in Arabic
 * script, so a naive script test classifies the scholar's own commentary as a
 * quotation and the real quotation gets crowded out of the budget.
 */
const URDU_ONLY = /[ٹڈڑںہھےگچپژۓۂ]/;
const ARABIC_LETTER = /[ؠ-ي]/;

/** Split into sentences on Urdu, Arabic and Latin terminators plus newlines. */
function toSegments(text: string): string[] {
  return text
    .split(/(?<=[۔؟!?.])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sentences that read as quoted Arabic: long enough to be a real passage, made
 * of Arabic letters, and free of Urdu-only letters. Text inside ﴿﴾ or «» counts
 * regardless, since those brackets are an explicit quotation marker.
 */
function extractQuotations(text: string): string[] {
  const bracketed = (text.match(/﴿[^﴾]{10,}﴾|«[^»]{10,}»/g) ?? []).map((q) => q.trim());

  const sentences = toSegments(text).filter(
    (s) => s.length >= 20 && ARABIC_LETTER.test(s) && !URDU_ONLY.test(s),
  );

  // De-duplicate: a bracketed quote is usually also its own sentence.
  return Array.from(new Set([...bracketed, ...sentences]));
}

export function buildRetrievalQuery(text: string, budget = 4000): string {
  const HEAD = 1200;
  const TAIL = 800;

  const quotations = extractQuotations(text);

  const head = text.slice(0, HEAD);
  const tail = text.length > HEAD + TAIL ? text.slice(-TAIL) : "";

  const parts: string[] = [];
  let used = 0;

  // Quotations first: when the budget runs out it must run out on prose, never
  // on the passage the citation is actually for.
  for (const part of [...quotations, head, tail]) {
    if (!part) continue;
    if (used + part.length > budget) {
      const room = budget - used;
      if (room > 80) {
        parts.push(part.slice(0, room));
        used += room;
      }
      break;
    }
    parts.push(part);
    used += part.length;
  }

  return parts.join("\n").trim() || text.slice(0, budget);
}

/**
 * How much of each retrieved source to put in the prompt.
 *
 * The old fixed `.slice(0, 600)` was a prompt-budget decision disguised as a
 * constant: with 8 results it spent 4,800 characters; with 2 it left most of the
 * budget unused while starving the model of the evidence it was asked to cite.
 * Spread one total across however many sources came back.
 */
export function perSourceBudget(count: number): number {
  const CONTEXT_BUDGET = 9000;
  if (count <= 0) return 600;
  return Math.min(1500, Math.max(400, Math.floor(CONTEXT_BUDGET / count)));
}
