/**
 * Translation settings that travel with every page (SYSTEM-2026 §6): the
 * style (literal or idiomatic) and a glossary of fixed terms ("صلاۃ ← Salah")
 * so a whole book renders them the same way. They reach the model through the
 * `genreInstruction` field translate-page already accepts, so no server
 * change is needed.
 */

export interface GlossaryEntry {
  source: string;
  target: string;
}

export type TranslationStyle = "idiomatic" | "literal";

/** Diacritics (Arabic harakat among them) and tatweel — ignored when looking for a term. */
const MARKS = /\p{Mn}|\u0640/gu;

export function matchKey(text: string): string {
  return text.replace(MARKS, "").toLowerCase();
}

/** Trimmed, non-empty entries; a repeated source term keeps its last target. */
export function cleanGlossary(entries: readonly GlossaryEntry[]): GlossaryEntry[] {
  const bySource = new Map<string, GlossaryEntry>();
  for (const e of entries) {
    const source = e.source?.trim() ?? "";
    const target = e.target?.trim() ?? "";
    if (!source || !target) continue;
    bySource.delete(matchKey(source));
    bySource.set(matchKey(source), { source, target });
  }
  return [...bySource.values()];
}

/** A glossary read back from storage — anything malformed is dropped. */
export function parseGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  return cleanGlossary(
    raw.filter((e): e is GlossaryEntry =>
      !!e && typeof e === "object" && typeof (e as GlossaryEntry).source === "string" && typeof (e as GlossaryEntry).target === "string"),
  );
}

/**
 * Pasted lines, one term per line: "صلاۃ = Salah", "صلاۃ ← Salah",
 * "صلاۃ -> Salah", or tab-separated (a spreadsheet column pair).
 */
export function parseGlossaryText(text: string): GlossaryEntry[] {
  const entries: GlossaryEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(/\t|\s*(?:->|=>|=|←|→)\s*/);
    if (parts.length >= 2) entries.push({ source: parts[0], target: parts.slice(1).join(" ") });
  }
  return cleanGlossary(entries);
}

/** The entries whose source term occurs in `text` — only those are worth sending. */
export function glossaryFor(text: string, glossary: readonly GlossaryEntry[]): GlossaryEntry[] {
  const key = matchKey(text);
  return glossary.filter((e) => key.includes(matchKey(e.source)));
}

/**
 * Terms the translator was asked to keep but did not: the source term is in
 * the source paragraph and its fixed rendering is missing from the translation.
 */
export function glossaryMisses(source: string, translation: string, glossary: readonly GlossaryEntry[]): GlossaryEntry[] {
  if (!translation.trim()) return [];
  const target = matchKey(translation);
  return glossaryFor(source, glossary).filter((e) => !target.includes(matchKey(e.target)));
}

const STYLE_INSTRUCTION: Record<TranslationStyle, string> = {
  idiomatic: "Style: idiomatic — fluent, natural prose in the target language that keeps the meaning exactly.",
  literal:
    "Style: literal — this overrides rule 5. Translate closely, keeping the source's sentence structure, order and wording wherever the target language allows; do not paraphrase, merge or drop clauses.",
};

export const PARAGRAPH_RULE =
  "The source is divided into paragraphs separated by one blank line. Return exactly the same number of paragraphs, in the same order, separated by one blank line — never merge or split them.";

/**
 * The instruction sent with a page: genre, style, the glossary terms that
 * occur in this text, the paragraph rule, and any one-off request ("make it
 * more fluent") for re-translating a single paragraph.
 */
export function composeInstruction({
  genrePrompt,
  style,
  glossary,
  text,
  paragraphs = true,
  extra,
}: {
  genrePrompt?: string;
  style: TranslationStyle;
  glossary: readonly GlossaryEntry[];
  /** The source text, to send only the glossary terms it contains; omit to send all. */
  text?: string;
  /** Add the keep-the-same-paragraphs rule (off for a page image, whose paragraphs are not known). */
  paragraphs?: boolean;
  extra?: string;
}): string {
  const parts: string[] = [];
  if (genrePrompt?.trim()) parts.push(genrePrompt.trim());
  parts.push(STYLE_INSTRUCTION[style]);
  const terms = text === undefined ? glossary : glossaryFor(text, glossary);
  if (terms.length) {
    parts.push(
      "Glossary — always render these terms exactly as given:\n" +
        terms.map((e) => `- ${e.source} → ${e.target}`).join("\n"),
    );
  }
  if (paragraphs) parts.push(PARAGRAPH_RULE);
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join("\n");
}
