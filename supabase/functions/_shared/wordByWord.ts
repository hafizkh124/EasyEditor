// Word-by-word Quran lookup (لفظی ترجمہ) — Corpus Atlas finding #6.
//
// 6,234 rows under domain `islamicurdubooks-wbw`, one per ayah, each holding
// the per-word Urdu gloss ("اَللّٰہُ : اللہ تعالی / لَاۤ : نہیں / ...").
// Before this module they were reachable by NOTHING: the only mention of the
// domain anywhere in the edge functions was `SKIP_DOMAIN` in
// backfill-embeddings, which deliberately keeps them OUT of the vector space
// (a list of word meanings makes a semantically mushy vector that crowds real
// hadith out of top-k). They also carry no content_ar, so neither lexical RPC
// can see them either.
//
// So this is deliberately NOT a search channel. It is a keyed fetch:
// `passage_key = wbw:iub:{surah}:{ayah}`, and it only runs when the user both
// (a) names one specific ayah and (b) actually asks for word meanings. That
// pairing is the whole safety argument — the Atlas's objection to putting this
// corpus in ranked search stands, and this never puts it there.

/** Does the query actually ask for a per-word gloss?
 *
 *  Kept narrow on purpose. "ترجمہ" alone must NOT fire this: almost every
 *  Quran question in this app involves a translation of some kind, and
 *  answering with a word list instead of the ayah's meaning would be worse
 *  than answering nothing. The distinguishing idea is word-BY-word. */
const WBW_MARKERS =
  /لفظی\s*ترجم|لفظ\s*بہ\s*لفظ|لفظ\s*با\s*لفظ|لغوی\s*ترجم|ہر\s*لفظ\s*کا\s*(?:معنی|مطلب|ترجم)|word[-\s]*by[-\s]*word|\bwbw\b/i;

export function wantsWordByWord(query: string): boolean {
  return WBW_MARKERS.test(query ?? "");
}

/** The passage_key for one ayah's gloss, or null when the reference is not a
 *  complete surah+ayah pair. An ayah number without its surah identifies 114
 *  different verses, so a partial reference is refused rather than guessed. */
export function wordByWordKey(surah: number | null, verse: number | null): string | null {
  if (surah == null || verse == null) return null;
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  if (!Number.isInteger(verse) || verse < 1) return null;
  return `wbw:iub:${surah}:${verse}`;
}

export interface WordByWordRow {
  domain: string;
  content: string;
  citation_ref: Record<string, unknown>;
  language: string;
}

/**
 * Fetch one ayah's word-by-word gloss. Returns [] unless the query asks for a
 * gloss AND names a complete surah+ayah — never throws, so a failure here can
 * only ever cost this one extra block, not the whole answer.
 */
export async function wordByWordChannel(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  query: string,
  surah: number | null,
  verse: number | null,
): Promise<WordByWordRow[]> {
  if (!wantsWordByWord(query)) return [];
  const key = wordByWordKey(surah, verse);
  if (!key) return [];

  try {
    const { data, error } = await supabase
      .from("scholarly_documents")
      .select("domain, content, citation_ref, language")
      .eq("passage_key", key)
      .limit(1);
    if (error) {
      console.error("[wordByWord] lookup error:", error);
      return [];
    }
    // deno-lint-ignore no-explicit-any
    return (data ?? []).map((r: any) => ({
      domain: r.domain,
      content: r.content ?? "",
      citation_ref: r.citation_ref ?? {},
      language: r.language ?? "ur",
    }));
  } catch (e) {
    console.error("[wordByWord] threw:", e);
    return [];
  }
}
