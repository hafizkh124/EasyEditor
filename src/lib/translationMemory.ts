import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";

const log = logger.child("translationMemory");

export interface TranslationMemoryMatch {
  passage_key?: string;
  source_text: string;
  translated_text: string;
  translator_slug?: string;
  match_score: number; // 0.0 to 1.0
  source_type: "passage" | "project_history" | "exact";
}

/**
 * Searches Translation Memory (TM) for a given text snippet:
 * 1. Checks exact Quran/Hadith passage translations (if passage_key matches or text matches)
 * 2. Checks previous project translation chunks
 */
export async function lookupTranslationMemory(
  sourceText: string,
  targetLang = "ur",
  genre = "general"
): Promise<TranslationMemoryMatch[]> {
  if (!sourceText || !sourceText.trim()) return [];
  const clean = sourceText.trim();
  const matches: TranslationMemoryMatch[] = [];

  try {
    // 1. Exact passage key lookup if text is in format '2:255' or 'quran:2:255'
    if (/^(?:quran:)?\d+:\d+$/i.test(clean)) {
      const key = clean.startsWith("quran:") ? clean : `quran:${clean}`;
      // Read through the server: the browser can no longer read this table
      // directly (its "any signed-in user" read policy was dropped).
      const { data: reply } = await supabase.functions.invoke("corpus-reads", {
        body: { action: "passage-translations", passageKey: key, language: targetLang },
      });
      const data = (reply as { rows?: Array<{ passage_key: string; translator_slug: string; text: string }> } | null)?.rows;

      if (data && data.length > 0) {
        data.forEach((row) => {
          matches.push({
            passage_key: row.passage_key,
            source_text: clean,
            translated_text: row.text,
            translator_slug: row.translator_slug,
            match_score: 1.0,
            source_type: "passage",
          });
        });
      }
    }

    // 2. Historical chunks from the user's own projects with the SAME source text.
    //    translation_chunks has no language of its own — it lives on the parent
    //    project — so we inner-join and filter there. Without that filter an
    //    English translation of the same Arabic line would be suggested inside
    //    an Urdu project. RLS already restricts rows to the signed-in user.
    const { data: chunkData } = await supabase
      .from("translation_chunks")
      .select("source_text, translated_text, passage_key, translation_projects!inner(target_lang, genre)")
      .eq("source_text", clean)
      .neq("translated_text", "")
      .eq("translation_projects.target_lang", targetLang)
      .limit(10);

    if (chunkData) {
      chunkData.forEach((c) => {
        if (!c.source_text || !c.translated_text) return;
        if (c.source_text.trim() !== clean) return;
        // A match from a project of the same discipline is more trustworthy
        // than one from an unrelated genre, so rank it slightly higher.
        const proj = c.translation_projects as unknown as { genre?: string } | null;
        const sameGenre = proj?.genre === genre;
        matches.push({
          source_text: c.source_text,
          translated_text: c.translated_text,
          passage_key: c.passage_key ?? undefined,
          match_score: sameGenre ? 0.95 : 0.85,
          source_type: "project_history",
        });
      });
    }
  } catch (err) {
    log.error("Translation memory lookup error", { err });
  }

  // Deduplicate and sort highest score first
  const seen = new Set<string>();
  return matches.filter((m) => {
    if (seen.has(m.translated_text)) return false;
    seen.add(m.translated_text);
    return true;
  }).sort((a, b) => b.match_score - a.match_score);
}

/** Genre-specific translation guidelines/prompts */
export const GENRE_TRANSLATION_PROMPTS: Record<string, { label: string; desc: string; prompt: string }> = {
  general: {
    label: "عام اسلوب (General)",
    desc: "سلیس اور با محاورہ سائنسی و ادبی ترجمہ",
    prompt: "ترجمہ سلیس، با محاورہ اور روانی کے ساتھ کریں۔ مفہوم کو برقرار رکھتے ہوئے عام فہم اردو استعمال کریں۔",
  },
  tafsir: {
    label: "فنِ تفسیر (Tafsir & Exegesis)",
    desc: "قرآنی بلاغت، اقوالِ مفسرین اور نحوی باریکیوں کا لحاظ",
    prompt: "یہ تفسیر کا متن ہے۔ ترجمہ میں قرآنی بلاغت، شانِ نزول کے قرائن اور مفسرین کے اصطلاحی الفاظ کا باادب تحفظ کریں۔",
  },
  fiqh: {
    label: "فنِ فقہ و افتاء (Fiqh & Fatawa)",
    desc: "فقہی اصطلاحات، فروعی جزئیات اور دقیق تعبیرات",
    prompt: "یہ فقہی متن ہے۔ اصطلاحات (مثلاً: واجب، مستحب، فاسد، باطل، عدمِ جواز) کا دقیق فقہی ترجمہ کریں۔ اقوالِ ائمہ کو اصل لفظ کے ساتھ واضح کریں۔",
  },
  hadith: {
    label: "علومِ حدیث (Hadith & Rijal)",
    desc: "متنِ حدیث کا باادب ترجمہ اور راویوں کے طبقات کا حفظ",
    prompt: "یہ متنِ حدیث یا علم الرجال ہے۔ ترجمہ میں احترامِ نبوی ﷺ کا کامل لحاظ رکھیں اور متن کے ہر لفظ کی نسبت بلا کم وکاست برقرار رکھیں۔",
  },
  lughat: {
    label: "علمِ لغت و نحو (Lughat & Grammar)",
    desc: "لغوی اشتقاق، جذر اور نحوی اعراب و ترکیب کی وضاحت",
    prompt: "یہ لغوی یا نحوی متن ہے۔ مادّہ (جذر)، لغوی معنی اور ترکیبی پہلوؤں کو واضح اور مدلل انداز میں منتقل کریں۔",
  },
};
