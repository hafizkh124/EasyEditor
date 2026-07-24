/**
 * extract-translations — resolves the multiple authoritative translations
 * (tarajim) of a single Quran passage for the /extract "Translation
 * Comparison Matrix" surface.
 *
 * INVARIANT (must never be broken): every line of translation text returned
 * here comes from a real source — the passage_translations cache or a live
 * fetch from alquran.cloud — never from an LLM and never fabricated. If a
 * requested translator has no text available, it is simply omitted from the
 * response. The client must render an honest empty state, not placeholder text.
 *
 * Request:  { passage_key: "quran:2:255", slugs?: string[] }
 * Response: { passage_key, arabic, translations: [{ translator_slug,
 *             full_name, language, maslak, text, source_url }],
 *             unavailable: string[] }
 *
 * Auth: manual Bearer verification (registered verify_jwt = false).
 * Metering: 5 tokens (citation_search) per uncached lookup; refunded if
 * nothing at all was found.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import {
  calculateCost,
  checkAndDeductTokens,
  refundTokens,
  insufficientTokensResponse,
} from "../_shared/tokenGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALQURAN_ARABIC_EDITION = "quran-uthmani";

interface TranslatorRow {
  slug: string;
  full_name: string;
  language: string;
  maslak: string | null;
  source: string;
  external_edition_id: string | null;
}

interface TranslationOut {
  translator_slug: string;
  full_name: string;
  language: string;
  maslak: string | null;
  text: string;
  source_url: string | null;
}

async function fetchWithTimeout(url: string, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/** Parse "quran:2:255" -> { surah: 2, ayah: 255 }. Returns null if not a Quran key. */
function parseQuranKey(passageKey: string): { surah: number; ayah: number } | null {
  const m = passageKey.match(/^quran:(\d+):(\d+)$/);
  if (!m) return null;
  return { surah: Number(m[1]), ayah: Number(m[2]) };
}

/** Fetch a single ayah's text for a given alquran.cloud edition. Never throws. */
async function fetchAlquranAyah(ref: string, edition: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.alquran.cloud/v1/ayah/${ref}/${encodeURIComponent(edition)}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.data?.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch {
    return null;
  }
}

/** Parse "hadith:bukhari:1" -> { collection: "bukhari", number: "1" }. */
function parseHadithKey(passageKey: string): { collection: string; number: string } | null {
  const m = passageKey.match(/^hadith:([a-z0-9-]+):(.+)$/i);
  if (!m) return null;
  return { collection: m[1].toLowerCase(), number: m[2].trim() };
}

/** Our internal collection slug (queryPlanner COLLECTION_SLUGS) → HadithAPI.com
 *  bookSlug. Only collections HadithAPI actually serves are mapped; the rest
 *  return an honest "unavailable" rather than a wrong book. Slugs mirror the
 *  documented set in islamic-api-fetch/fetchHadithApi. */
const HADITH_BOOK_SLUGS: Record<string, string> = {
  bukhari:  "sahih-bukhari",
  muslim:   "sahih-muslim",
  tirmidhi: "al-tirmidhi",
  abudawud: "abu-dawood",
  ibnmajah: "ibn-e-majah",
  nasai:    "sunan-nasai",
  mishkat:  "mishkat",
  ahmed:    "musnad-ahmad",
};

/** Fetch one hadith (Arabic + Urdu + English) by book + number from HadithAPI.
 *  Returns the language texts keyed by HadithAPI field name, plus a source URL.
 *  Never throws; returns null when nothing usable comes back. */
async function fetchHadithApiOne(
  bookSlug: string,
  hadithNumber: string,
  apiKey: string,
): Promise<{ fields: Record<string, string>; url: string } | null> {
  try {
    const url =
      `https://hadithapi.com/api/hadiths/?apiKey=${encodeURIComponent(apiKey)}` +
      `&book=${encodeURIComponent(bookSlug)}` +
      `&hadithNumber=${encodeURIComponent(hadithNumber)}&paginate=1`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = (data?.hadiths?.data ?? data?.hadiths ?? [])[0];
    if (!item) return null;
    const fields: Record<string, string> = {};
    for (const key of ["hadithArabic", "hadithUrdu", "hadithEnglish"]) {
      const v = item[key];
      if (typeof v === "string" && v.trim()) fields[key] = v.trim();
    }
    if (Object.keys(fields).length === 0) return null;
    return {
      fields,
      url: `https://hadithapi.com/hadith/${bookSlug}/${item.hadithNumber ?? hadithNumber}`,
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isRateLimited(user.id, 30, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { passage_key, slugs } = await req.json();
    if (!passage_key || typeof passage_key !== "string") {
      return new Response(JSON.stringify({ error: "passage_key is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jsonResponse = (body: unknown) =>
      new Response(JSON.stringify(body), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // ══ Hadith path ══════════════════════════════════════════════════════════
    const hadith = parseHadithKey(passage_key.trim());
    if (hadith) {
      const bookSlug = HADITH_BOOK_SLUGS[hadith.collection];
      if (!bookSlug) {
        return jsonResponse({
          passage_key, arabic: null, translations: [], unavailable: [],
          note: "اس مجموعے کے تراجم HadithAPI پر دستیاب نہیں (بخاری، مسلم، ترمذی، ابو داؤد، ابن ماجہ، نسائی، مشکاۃ، مسند احمد سپورٹڈ ہیں)۔",
        });
      }

      const { data: hTranslators } = await supabase
        .from("translators")
        .select("slug, full_name, language, maslak, source, external_edition_id")
        .eq("is_enabled", true)
        .eq("corpus_type", "hadith")
        .order("sort_order", { ascending: true });
      const wanted = (hTranslators ?? []) as TranslatorRow[];
      if (wanted.length === 0) {
        return jsonResponse({ passage_key, arabic: null, translations: [], unavailable: [] });
      }

      // Cached first.
      const { data: cachedRows } = await supabase
        .from("passage_translations")
        .select("translator_slug, language, text, source_url")
        .eq("passage_key", passage_key)
        .in("translator_slug", wanted.map((t) => t.slug));
      const cached = new Map<string, { language: string; text: string; source_url: string | null }>();
      for (const r of cachedRows ?? []) {
        cached.set(r.translator_slug, { language: r.language, text: r.text, source_url: r.source_url });
      }

      const missing = wanted.filter((t) => !cached.has(t.slug));
      const HADITH_API_KEY = Deno.env.get("HADITH_API_KEY") ?? "";

      if (missing.length > 0) {
        if (!HADITH_API_KEY) {
          // Nothing cached and no key to fetch — honest, no fabrication.
          if (cached.size === 0) {
            return jsonResponse({
              passage_key, arabic: null, translations: [], unavailable: [],
              note: "حدیث کے تراجم کے لیے HadithAPI کلید سیٹ نہیں ہے۔",
            });
          }
        } else {
          const tokenCost = calculateCost("citation_search", 1);
          const tokenResult = await checkAndDeductTokens(
            supabase, user.id, tokenCost, "citation_search", `Hadith extract: ${passage_key}`,
          );
          if (!tokenResult.ok) return insufficientTokensResponse(tokenResult, corsHeaders);

          const fetched = await fetchHadithApiOne(bookSlug, hadith.number, HADITH_API_KEY);
          const toInsert: Array<{
            passage_key: string; translator_slug: string; language: string;
            text: string; source_url: string; is_verified: boolean;
          }> = [];
          if (fetched) {
            for (const t of missing) {
              const field = t.external_edition_id ?? "";
              const text = fetched.fields[field];
              if (text) {
                toInsert.push({
                  passage_key, translator_slug: t.slug, language: t.language,
                  text, source_url: fetched.url, is_verified: false,
                });
                cached.set(t.slug, { language: t.language, text, source_url: fetched.url });
              }
            }
          }
          if (toInsert.length > 0) {
            const { error: insErr } = await supabase
              .from("passage_translations")
              .upsert(toInsert, { onConflict: "passage_key,translator_slug" });
            if (insErr) console.error("extract-translations hadith cache upsert error:", insErr.message);
          }
          // Refund if the fetch produced nothing usable at all.
          if (cached.size === 0) {
            await refundTokens(supabase, user.id, tokenCost, "citation_search", "No hadith text found");
          }
        }
      }

      // Assemble: hadith.ar → `arabic`; ur/en → translations. Omit anything absent.
      const arabicHit = cached.get("hadith.ar");
      const translations: TranslationOut[] = [];
      const unavailable: string[] = [];
      for (const t of wanted) {
        if (t.slug === "hadith.ar") continue; // shown as the passage arabic
        const hit = cached.get(t.slug);
        if (hit) {
          translations.push({
            translator_slug: t.slug, full_name: t.full_name, language: hit.language,
            maslak: t.maslak, text: hit.text, source_url: hit.source_url,
          });
        } else {
          unavailable.push(t.slug);
        }
      }
      return jsonResponse({
        passage_key,
        arabic: arabicHit?.text ?? null,
        translations,
        unavailable,
      });
    }

    // ══ Quran path ═══════════════════════════════════════════════════════════
    const quran = parseQuranKey(passage_key.trim());
    if (!quran) {
      return jsonResponse({
        passage_key, arabic: null, translations: [], unavailable: [],
        note: "صرف قرآن (quran:surah:ayah) اور حدیث (hadith:collection:number) حوالے سپورٹڈ ہیں۔",
      });
    }
    const ref = `${quran.surah}:${quran.ayah}`;

    // ── Load the requested (or all enabled) translators ───────────────────────
    let translatorQuery = supabase
      .from("translators")
      .select("slug, full_name, language, maslak, source, external_edition_id")
      .eq("is_enabled", true)
      .eq("corpus_type", "quran");
    if (Array.isArray(slugs) && slugs.length > 0) {
      translatorQuery = translatorQuery.in("slug", slugs);
    }
    const { data: translators, error: tErr } = await translatorQuery;
    if (tErr) {
      console.error("extract-translations translators error:", tErr.message);
      return new Response(JSON.stringify({ error: "Failed to load translators" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const wanted = (translators ?? []) as TranslatorRow[];
    if (wanted.length === 0) {
      return new Response(
        JSON.stringify({ passage_key, arabic: null, translations: [], unavailable: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Serve cached translations first ───────────────────────────────────────
    const { data: cachedRows } = await supabase
      .from("passage_translations")
      .select("translator_slug, language, text, source_url")
      .eq("passage_key", passage_key)
      .in("translator_slug", wanted.map((t) => t.slug));
    const cachedBySlug = new Map<string, { language: string; text: string; source_url: string | null }>();
    for (const r of cachedRows ?? []) {
      cachedBySlug.set(r.translator_slug, { language: r.language, text: r.text, source_url: r.source_url });
    }

    const missing = wanted.filter((t) => !cachedBySlug.has(t.slug));

    // Only charge tokens when there is real fetch work to do.
    const tokenCost = missing.length > 0 ? calculateCost("citation_search", 1) : 0;
    if (tokenCost > 0) {
      const tokenResult = await checkAndDeductTokens(
        supabase, user.id, tokenCost, "citation_search", `Translation extract: ${passage_key}`,
      );
      if (!tokenResult.ok) {
        return insufficientTokensResponse(tokenResult, corsHeaders);
      }
    }

    // ── Fetch Arabic (Uthmani) once + all missing translations in parallel ────
    const [arabicText, ...fetchedTexts] = await Promise.all([
      fetchAlquranAyah(ref, ALQURAN_ARABIC_EDITION),
      ...missing.map((t) =>
        t.source === "alquran.cloud" && t.external_edition_id
          ? fetchAlquranAyah(ref, t.external_edition_id)
          : Promise.resolve(null),
      ),
    ]);

    // ── Persist newly fetched translations to the cache (service role) ────────
    const toInsert: {
      passage_key: string; translator_slug: string; language: string;
      text: string; source_url: string; is_verified: boolean;
    }[] = [];
    missing.forEach((t, i) => {
      const text = fetchedTexts[i];
      if (text) {
        const sourceUrl = `https://alquran.cloud/ayah/${ref}/${t.external_edition_id}`;
        toInsert.push({
          passage_key,
          translator_slug: t.slug,
          language: t.language,
          text,
          source_url: sourceUrl,
          is_verified: false, // cached from API, not scholar-verified
        });
        cachedBySlug.set(t.slug, { language: t.language, text, source_url: sourceUrl });
      }
    });
    if (toInsert.length > 0) {
      const { error: insErr } = await supabase
        .from("passage_translations")
        .upsert(toInsert, { onConflict: "passage_key,translator_slug" });
      if (insErr) console.error("extract-translations cache upsert error:", insErr.message);
    }

    // ── Assemble ordered response; omit any translator with no real text ──────
    const translations: TranslationOut[] = [];
    const unavailable: string[] = [];
    for (const t of wanted) {
      const hit = cachedBySlug.get(t.slug);
      if (hit) {
        translations.push({
          translator_slug: t.slug,
          full_name: t.full_name,
          language: hit.language,
          maslak: t.maslak,
          text: hit.text,
          source_url: hit.source_url,
        });
      } else {
        unavailable.push(t.slug);
      }
    }

    // Refund if the whole lookup yielded nothing usable.
    if (tokenCost > 0 && translations.length === 0) {
      await refundTokens(supabase, user.id, tokenCost, "citation_search", "No translations found");
    }

    return new Response(
      JSON.stringify({ passage_key, arabic: arabicText, translations, unavailable }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("extract-translations error:", e);
    return new Response(
      JSON.stringify({ error: "Extraction failed", translations: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
