import {
  wantsWordByWord,
  wordByWordKey,
  wordByWordChannel,
} from "../../supabase/functions/_shared/wordByWord";
import { resultIdentity, dedupeResults } from "../../supabase/functions/_shared/resultIdentity";

/**
 * Corpus Atlas finding #6: the 6,234-row word-by-word Quran gloss
 * (`islamicurdubooks-wbw`) was reachable by nothing — its only mention
 * anywhere in the edge functions was `SKIP_DOMAIN` in backfill-embeddings,
 * which deliberately keeps it OUT of the vector space. It has no content_ar
 * either, so no lexical RPC could see it.
 *
 * The fix is a keyed fetch, never a search channel. These tests pin the two
 * gates that keep the Atlas's original objection satisfied — it fires only on
 * an explicit per-word request naming one complete ayah.
 */

function fakeSupabase(rowsByKey: Record<string, unknown[]>) {
  const queries: string[] = [];
  return {
    queries,
    client: {
      from: () => {
        let key = "";
        const api: Record<string, unknown> = {};
        Object.assign(api, {
          select: () => api,
          eq: (_col: string, val: string) => { key = val; return api; },
          limit: async () => {
            queries.push(key);
            return { data: rowsByKey[key] ?? [], error: null };
          },
        });
        return api;
      },
    },
  };
}

const glossRow = {
  domain: "islamicurdubooks-wbw",
  content: "لفظی ترجمہ قرآن - سورۃ 2، آیت 255\n\nاَللّٰہُ : اللہ تعالی\nلَاۤ : نہیں",
  citation_ref: { surah_number: 2, verse: 255, faayat_id: 262 },
  language: "ur",
};

describe("wantsWordByWord", () => {
  it("fires on an explicit per-word request", () => {
    for (const q of [
      "سورہ بقرہ آیت 255 کا لفظی ترجمہ",
      "آیت الکرسی کا لفظ بہ لفظ ترجمہ دکھائیں",
      "ہر لفظ کا معنی بتائیں",
      "word by word translation of 2:255",
    ]) {
      expect(wantsWordByWord(q), q).toBe(true);
    }
  });

  it("does NOT fire on an ordinary translation request", () => {
    // The whole safety argument: "ترجمہ" alone is in a huge share of this
    // app's Quran questions. Answering those with a word list instead of the
    // ayah's meaning would be worse than answering nothing.
    for (const q of [
      "سورہ بقرہ آیت 255 کا ترجمہ",
      "اس آیت کا مطلب کیا ہے؟",
      "آیت الکرسی کی تفسیر بیان کریں",
      "نماز سے متعلق آیات",
    ]) {
      expect(wantsWordByWord(q), q).toBe(false);
    }
  });
});

describe("wordByWordKey", () => {
  it("builds the passage_key for a complete reference", () => {
    expect(wordByWordKey(2, 255)).toBe("wbw:iub:2:255");
    expect(wordByWordKey(1, 1)).toBe("wbw:iub:1:1");
  });

  it("refuses a partial reference rather than guessing", () => {
    // An ayah number with no surah points at 114 different verses.
    expect(wordByWordKey(null, 255)).toBeNull();
    expect(wordByWordKey(2, null)).toBeNull();
    expect(wordByWordKey(null, null)).toBeNull();
  });

  it("rejects an out-of-range surah or ayah", () => {
    expect(wordByWordKey(0, 1)).toBeNull();
    expect(wordByWordKey(115, 1)).toBeNull();
    expect(wordByWordKey(2, 0)).toBeNull();
    expect(wordByWordKey(2.5, 1)).toBeNull();
  });
});

describe("wordByWordChannel", () => {
  it("fetches the gloss when intent and a full reference are both present", async () => {
    const fake = fakeSupabase({ "wbw:iub:2:255": [glossRow] });
    const rows = await wordByWordChannel(fake.client, "آیت 255 کا لفظی ترجمہ", 2, 255);
    expect(rows).toHaveLength(1);
    expect(rows[0].domain).toBe("islamicurdubooks-wbw");
    expect(fake.queries).toEqual(["wbw:iub:2:255"]);
  });

  it("does not touch the database without the per-word intent", async () => {
    const fake = fakeSupabase({ "wbw:iub:2:255": [glossRow] });
    const rows = await wordByWordChannel(fake.client, "آیت 255 کا ترجمہ", 2, 255);
    expect(rows).toEqual([]);
    expect(fake.queries).toEqual([]);
  });

  it("does not touch the database without a complete reference", async () => {
    const fake = fakeSupabase({});
    const rows = await wordByWordChannel(fake.client, "لفظی ترجمہ دکھائیں", null, null);
    expect(rows).toEqual([]);
    expect(fake.queries).toEqual([]);
  });

  it("never throws when the query errors", async () => {
    const broken = { from: () => { throw new Error("boom"); } };
    await expect(
      wordByWordChannel(broken, "لفظی ترجمہ", 2, 255),
    ).resolves.toEqual([]);
  });
});

describe("gloss vs ayah identity (dedup regression)", () => {
  it("gives the gloss a different identity from the ayah at the same locus", () => {
    // Both carry surah_number 2 / verse 255. Keying both as quran:2:255 would
    // make dedupeResults delete one — silently answering a word-by-word
    // question with the plain ayah, or vice versa.
    const ayah = { domain: "tanzil", citation_ref: { surah_number: 2, verse: 255 } };
    const gloss = { domain: "islamicurdubooks-wbw", citation_ref: { surah_number: 2, verse: 255 } };

    expect(resultIdentity(ayah)).toBe("quran:2:255");
    expect(resultIdentity(gloss)).toBe("wbw:2:255");
    expect(resultIdentity(ayah)).not.toBe(resultIdentity(gloss));
  });

  it("keeps both the ayah and its gloss through de-duplication", () => {
    const ayah = { domain: "tanzil", citation_ref: { surah_number: 2, verse: 255 } };
    const gloss = { domain: "islamicurdubooks-wbw", citation_ref: { surah_number: 2, verse: 255 } };
    expect(dedupeResults([ayah, gloss])).toHaveLength(2);
  });

  it("still collapses two copies of the same ayah from different sources", () => {
    // The original dedup behaviour must survive the wbw carve-out.
    const a = { domain: "tanzil", citation_ref: { surah_number: 2, verse: 255 } };
    const b = { domain: "alquran", citation_ref: { surah_number: 2, verse: 255 } };
    expect(dedupeResults([a, b])).toHaveLength(1);
  });
});
