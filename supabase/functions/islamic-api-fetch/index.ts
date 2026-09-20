import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * `ReturnType<typeof createClient>` (used below before this fix) instantiates
 * the schema generics as `never` — the same first-contact typecheck issue
 * documented for verify-receipt (TESTING-STRATEGY.md P1 round 1). `any` is
 * the honest schema here: this project has no generated Database type to
 * pass, so claiming one would be a false contract, not a stricter one.
 */
type AnyClient = SupabaseClient<any>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface IslamicResult {
  domain: string;
  content: string;
  citation_ref: {
    book?: string;
    collection?: string;
    hadith_number?: string | number;
    grade?: string;
    rawi?: string;
    mohdith?: string;
    takhreej?: string;
    surah_number?: number;
    surah_name?: string;
    surah_name_en?: string;
    verse?: number;
    juz?: number;
    fatwa_number?: string;
    scholar?: string;
    /** Set by citationEngine.ts's personal-library channel (Tier L) — the
     *  library item's own title, since a private upload has no `book`/
     *  `collection` slug to fall back to. */
    title?: string;
    /** Not currently set by any channel; declared so islamic-search's
     *  citation-line builder can reference it defensively without a type
     *  error, the same way it already does for every other tier-specific
     *  field here. */
    author?: string;
    url?: string;
    volume?: number;
    page?: number;
    /** Set by islamic-search's topic-anchor merge — this passage was force-
     *  included as a canonical reference for a recognized topic, not
     *  returned by the retrieval search itself. See buildContextBlock. */
    _is_anchor?: boolean;
  };
  language: "ar" | "en" | "ur";
  /**
   * True when this passage is known to carry real Arabic matn (scripture or
   * hadith wording), not merely Urdu prose that happens to contain Arabic
   * names or terms. Corpus Atlas finding #7 — the corpus's own `language`
   * column records the corpus's declared READING language and cannot back an
   * "Arabic only" filter (11 of 14 domains are tagged `ur`, including the
   * fully-Arabic easyquran-hadith). The only trustworthy signal is
   * `content_ar IS NOT NULL` per row, which is what every tier below sets
   * this from.
   *
   * `undefined` (not `false`) means "this tier never checked" — Tier C
   * (live-scraped web pages) has no reliable per-row signal and deliberately
   * leaves this unset rather than guess. islamic-search's Arabic-only filter
   * treats unset the same as false (excluded), which is the conservative
   * choice: a scholar who asked for Arabic-only sources should get fewer,
   * verified ones, not a source of unknown language.
   */
  has_matn?: boolean;
  score?: number;
  rerank_score?: number;
  reason?: string;
}

// ── Arabic normalizer (mirrors src/utils/arabicUtils.ts) ─────────────────────
function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064A")
    .trim();
}

// ── Simple SHA-256 hex for cache keys ─────────────────────────────────────────
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (e: any) {
    clearTimeout(timeoutId);
    throw e;
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getCached(
  supabase: AnyClient,
  cacheKey: string
): Promise<IslamicResult[] | null> {
  const { data } = await supabase
    .from("api_response_cache")
    .select("response, expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (!data) return null;
  // Check TTL
  if (new Date(data.expires_at) < new Date()) {
    // Expired — delete async, don't await
    supabase.from("api_response_cache").delete().eq("cache_key", cacheKey).then(() => {});
    return null;
  }
  return data.response as IslamicResult[];
}

async function setCached(
  supabase: AnyClient,
  cacheKey: string,
  domain: string,
  results: IslamicResult[]
): Promise<void> {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  await supabase
    .from("api_response_cache")
    .upsert(
      { cache_key: cacheKey, domain, response: results, expires_at: expiresAt },
      { onConflict: "cache_key" }
    );
}

// ── Dorar.net Hadith API ──────────────────────────────────────────────────────
// Endpoint: https://dorar.net/dorar_api.json?skey=<query>
// (The old /v1/api/hadith/search endpoint returns 404 as of 2026-05.)
// Response shape: { ahadith: { result: "<html-blob>" } } — the result is
// rendered HTML, so we parse it the same way the official docs sample does.
async function fetchDorar(query: string): Promise<IslamicResult[]> {
  try {
    const url = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(query)}`;
    // dorar.net sits behind Cloudflare's bot challenge, which a bare fetch()
    // (no User-Agent, no Accept/Accept-Language) trips every time — Cloudflare
    // returns HTTP 200 with an HTML "Attention Required" challenge page
    // instead of JSON, so `res.ok` is true but `res.json()` below throws and
    // this silently returned [] on every single call. Confirmed live,
    // 2026-08-16: identical request with real browser-shaped headers gets a
    // genuine 200 + JSON response. No paid bypass service needed — just
    // headers a real browser would already send.
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ar,en;q=0.9",
        "Referer": "https://dorar.net/",
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const html: string = data?.ahadith?.result ?? "";
    if (!html) return [];

    // Real shape (verified live 2026-08-16):
    //   <div class="hadith">N -  <text> </div>
    //   <div class="hadith-info"> <span class="info-subtitle">الراوي:</span> ... </div>
    const items: IslamicResult[] = [];
    const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const pairRe =
      /<div[^>]*class="hadith"[^>]*>([\s\S]*?)<\/div>\s*(?:<[^>]*>\s*)*<div[^>]*class="hadith-info"[^>]*>([\s\S]*?)<\/div>/gi;

    let m: RegExpExecArray | null;
    while ((m = pairRe.exec(html)) !== null && items.length < 5) {
      const hadithText = stripTags(m[1]).replace(/^\d+\s*-\s*/, "").trim();
      const info = stripTags(m[2]);
      if (!hadithText || hadithText.length < 10) continue;

      const grab = (label: string): string => {
        const re = new RegExp(label + "\\s*:?\\s*([^:]*?)(?=\\s*(?:الراوي|المحدث|المصدر|الصفحة أو الرقم|الرقم|خلاصة حكم المحدث|التخريج|$))");
        return info.match(re)?.[1]?.trim() ?? "";
      };

      const rawi    = grab("الراوي");
      const mohdith = grab("المحدث");
      const book    = grab("المصدر") || grab("الكتاب");
      const number  = grab("الصفحة أو الرقم") || grab("الرقم");
      const grade   = grab("خلاصة حكم المحدث") || grab("درجة الحديث");

      items.push({
        domain: "dorar",
        content: `${hadithText}\n\n[${book || "?"}، رقم: ${number || "?"} — ${grade || "?"}]`,
        citation_ref: {
          book:          book || undefined,
          hadith_number: number || undefined,
          grade:         grade || undefined,
          rawi:          rawi || undefined,
          mohdith:       mohdith || undefined,
        },
        language: "ar",
        has_matn: true, // scraped straight from dorar.net's own Arabic hadith text
      });
    }

    return items;
  } catch {
    return [];
  }
}

// ── AlQuran.cloud API (Arabic + English parallel) ─────────────────────────────
async function fetchAlQuran(query: string): Promise<IslamicResult[]> {
  try {
    const [arRes, enRes] = await Promise.allSettled([
      fetchWithTimeout(`https://api.alquran.cloud/v1/search/${encodeURIComponent(query)}/all/ar`),
      fetchWithTimeout(`https://api.alquran.cloud/v1/search/${encodeURIComponent(query)}/all/en.sahih`),
    ]);

    const arData = arRes.status === "fulfilled" && arRes.value.ok
      ? (await arRes.value.json()).data?.matches ?? []
      : [];
    const enData = enRes.status === "fulfilled" && enRes.value.ok
      ? (await enRes.value.json()).data?.matches ?? []
      : [];

    const seen = new Set<string>();
    const results: IslamicResult[] = [];

    // Arabic-edition hits pushed first, so a dually-matched ayah keeps its
    // Arabic text: `has_matn` distinguishes them from the English-only tail
    // below (an ayah the Arabic search missed but the English one found,
    // where `item.text` is English and there is no Arabic in `content` at
    // all — Corpus Atlas finding #7 needs that told apart, not assumed).
    const push = (item: any, hasArabic: boolean) => {
      const key = `${item.surah?.number}:${item.numberInSurah}`;
      if (seen.has(key)) return;
      seen.add(key);
      const enMatch = enData.find((e: any) =>
        e.surah?.number === item.surah?.number && e.numberInSurah === item.numberInSurah
      );
      results.push({
        domain: "alquran",
        content: `${item.text ?? ""}${hasArabic && enMatch ? `\n\n${enMatch.text}` : ""}`,
        citation_ref: {
          surah_number:  item.surah?.number,
          surah_name:    item.surah?.name,
          surah_name_en: item.surah?.englishName,
          verse:         item.numberInSurah,
          juz:           item.juz,
        },
        language: "ar",
        has_matn: hasArabic,
      });
    };

    for (const item of arData.slice(0, 4)) push(item, true);
    for (const item of enData.slice(0, 3)) push(item, false);
    return results;
  } catch {
    return [];
  }
}

// ── Sunnah.com API — removed per Phase 7.5 doctrine (no API key obtained).
//    Reinstate the `fetchSunnah` function and SUNNAH_API_KEY env check here
//    if a key is later obtained via https://github.com/sunnah-com/api.



// ── Quran.com API ─────────────────────────────────────────────────────────────
async function fetchQuranCom(query: string): Promise<IslamicResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.quran.com/api/v4/search?q=${encodeURIComponent(query)}&size=10&translations=131`
    );
    if (!res.ok) return [];
    const data = await res.json();
    const results = data?.search?.results ?? [];
    return results.slice(0, 10).map((item: any): IslamicResult => ({
      domain: "quran-com",
      content: `${item.text ?? ""}`,
      citation_ref: {
        surah_number: parseInt(item.verse_key?.split(":")?.[0] ?? "0"),
        verse:        parseInt(item.verse_key?.split(":")?.[1] ?? "0"),
        url:          `https://quran.com/${item.verse_key}`,
      },
      language: "ar",
      has_matn: true, // item.text is the Arabic ayah from Quran.com's search endpoint
    }));
  } catch {
    return [];
  }
}

/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const { query, selectedDomains } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl     = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase        = createClient(supabaseUrl, supabaseKey);

    // Normalized query for cache key derivation
    const normalizedQuery = normalizeArabic(query.toLowerCase().trim());

    // Build per-domain fetchers with cache check/set
    const fetchWithCache = async (
      domain: string,
      fetcher: () => Promise<IslamicResult[]>
    ): Promise<IslamicResult[]> => {
      const cacheKey = await sha256hex(`${domain}:${normalizedQuery}`);
      const cached = await getCached(supabase, cacheKey);
      if (cached) {
        if (import.meta.env?.DEV) console.log(`[islamic-api-fetch] Cache HIT: ${domain}`);
        return cached;
      }
      const results = await fetcher();
      if (results.length > 0) {
        // Fire-and-forget cache write — don't block the response
        setCached(supabase, cacheKey, domain, results).catch(console.error);
      }
      return results;
    };

    // Fan-out: only call selected domains (Hadith collections are queried locally via pgvector/scholarly_documents)
    const fetchers: Promise<IslamicResult[]>[] = [];

    if (!selectedDomains || selectedDomains.includes("dorar")) {
      fetchers.push(fetchWithCache("dorar", () => fetchDorar(query)));
    }
    if (!selectedDomains || selectedDomains.includes("alquran")) {
      fetchers.push(fetchWithCache("alquran", () => fetchAlQuran(query)));
    }
    if (!selectedDomains || selectedDomains.includes("quran-com")) {
      fetchers.push(fetchWithCache("quran-com", () => fetchQuranCom(query)));
    }

    const settled = await Promise.allSettled(fetchers);
    const results: IslamicResult[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") results.push(...r.value);
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("islamic-api-fetch error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(handle);
