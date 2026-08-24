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

/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
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

    // ══ Hadith path — served entirely from the local scholarly_documents corpus
    const hadith = parseHadithKey(passage_key.trim());
    if (hadith) {
      // Rebuild the key from the parsed parts rather than using the raw input.
      // The backfill stores hadith keys as `hadith:{lowercased collection}:{number}`,
      // and rebuilding keeps untrusted text out of the PostgREST filter string.
      const canonicalKey = `hadith:${hadith.collection}:${hadith.number}`;

      // Exact match only. An `ilike '%:bukhari:1%'` style lookup also matches
      // 12, 100, 1234 … which would return a DIFFERENT hadith than the one
      // asked for while looking authoritative — a false attribution.
      const { data: docRows, error: docErr } = await supabase
        .from("scholarly_documents")
        .select("title, content, content_ar, citation_ref, language, source_url, domain")
        .eq("passage_key", canonicalKey)
        .limit(20);

      if (docErr) {
        console.error("extract-translations hadith lookup error:", docErr.message);
        return jsonResponse({
          passage_key, arabic: null, translations: [], unavailable: [],
          note: "حدیث تلاش کرتے وقت دشواری پیش آئی۔",
        });
      }

      const rows = docRows ?? [];
      if (rows.length === 0) {
        return jsonResponse({
          passage_key, arabic: null, translations: [], unavailable: [],
          note: "یہ حدیث ہمارے مقامی ذخیرے میں تلاش نہیں ہو سکی۔",
        });
      }

      // The same hadith can exist in several ingested domains (Arabic matn,
      // Urdu translation, English). Surface every one instead of an arbitrary
      // first row — comparing renderings is the point of /extract.
      const arabic = rows.map((r) => r.content_ar).find((t) => t && t.trim()) ?? null;

      const translations: TranslationOut[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const text = (r.content ?? "").trim();
        if (!text || seen.has(text)) continue;
        // Skip a row whose only content is the Arabic matn already shown above.
        if (arabic && text === arabic.trim()) continue;
        seen.add(text);
        translations.push({
          translator_slug: `local:${r.domain ?? "corpus"}`,
          // Must be `full_name` — that is the field the /extract table renders.
          full_name: String(r.title || r.citation_ref?.book || "حدیث مبارکہ"),
          language: r.language || "ar",
          maslak: null,
          text,
          source_url: r.source_url ?? null,
        });
      }

      return jsonResponse({ passage_key, arabic, translations, unavailable: [] });
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
}

Deno.serve(handle);
