import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    surah_number?: number;
    surah_name?: string;
    surah_name_en?: string;
    verse?: number;
    juz?: number;
    fatwa_number?: string;
    scholar?: string;
    url?: string;
    volume?: number;
    page?: number;
  };
  language: "ar" | "en" | "ur";
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
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
async function fetchDorar(query: string): Promise<IslamicResult[]> {
  try {
    const url = `https://www.dorar.net/v1/api/hadith/search?value=${encodeURIComponent(query)}&books=0`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.data ?? [];
    return items.slice(0, 5).map((item: any): IslamicResult => ({
      domain: "dorar",
      content: `${item.hadith ?? ""}\n\n[${item.book ?? ""}، رقم: ${item.hadithNumber ?? ""} — ${item.grade ?? ""}]`,
      citation_ref: {
        book:       item.book,
        hadith_number: item.hadithNumber,
        grade:      item.grade,
        rawi:       item.rawi,
        mohdith:    item.mohdith,
        collection: item.bookNumber ? String(item.bookNumber) : undefined,
      },
      language: "ar",
    }));
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

    for (const item of [...arData.slice(0, 4), ...enData.slice(0, 3)]) {
      const key = `${item.surah?.number}:${item.numberInSurah}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const enMatch = enData.find((e: any) =>
        e.surah?.number === item.surah?.number && e.numberInSurah === item.numberInSurah
      );
      results.push({
        domain: "alquran",
        content: `${item.text ?? ""}${enMatch ? `\n\n${enMatch.text}` : ""}`,
        citation_ref: {
          surah_number:  item.surah?.number,
          surah_name:    item.surah?.name,
          surah_name_en: item.surah?.englishName,
          verse:         item.numberInSurah,
          juz:           item.juz,
        },
        language: "ar",
      });
    }
    return results;
  } catch {
    return [];
  }
}

// ── Sunnah.com API (requires API key) ─────────────────────────────────────────
async function fetchSunnah(query: string, apiKey: string): Promise<IslamicResult[]> {
  if (!apiKey) return [];
  try {
    const res = await fetchWithTimeout(
      `https://api.sunnah.com/v1/hadiths?limit=5`,
      { headers: { "X-API-Key": apiKey } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.data ?? [];
    return items.slice(0, 5).map((item: any): IslamicResult => ({
      domain: "sunnah",
      content: `${item.body ?? item.hadith?.[0]?.body ?? ""}`,
      citation_ref: {
        collection:    item.collection,
        book:          item.bookName,
        hadith_number: item.hadithNumber,
        grade:         item.grades?.[0]?.grade,
        url:           `https://sunnah.com/${item.collection}:${item.hadithNumber}`,
      },
      language: "en",
    }));
  } catch {
    return [];
  }
}

// ── HadithAPI.com — Arabic + English + Urdu hadith search ───────────────────
// Docs: https://hadithapi.com/docs/hadiths
// Auth: query param ?apiKey=...   (HADITH_API_KEY is configured inside the Lovable platform)
// Books: sahih-bukhari, sahih-muslim, al-tirmidhi, abu-dawood, ibn-e-majah,
//        sunan-nasai, mishkat, musnad-ahmad, al-silsila-sahiha
function detectQueryLanguage(query: string): "ar" | "ur" | "en" {
  // Urdu-specific characters not present in Standard Arabic
  if (/[ٹڈڑںھہۂۃیے۔چ]/.test(query)) {
    return "ur";
  }
  // Any Arabic block character → treat as Arabic
  if (/[؀-ۿ]/.test(query)) return "ar";
  return "en";
}

async function fetchHadithApi(query: string, apiKey: string): Promise<IslamicResult[]> {
  if (!apiKey) return [];
  try {
    const lang = detectQueryLanguage(query);
    const param =
      lang === "ar" ? "hadithArabic" :
      lang === "ur" ? "hadithUrdu"   :
                      "hadithEnglish";
    const url = `https://hadithapi.com/api/hadiths/?apiKey=${encodeURIComponent(apiKey)}&${param}=${encodeURIComponent(query)}&paginate=10`;
    const res = await fetchWithTimeout(url, {}, 12_000);
    if (!res.ok) return [];
    const data = await res.json();
    // Response shape: { hadiths: { data: [{ id, hadithNumber, hadithArabic, hadithEnglish, hadithUrdu, book: { bookSlug, bookName }, chapter: { chapterEnglish }, englishNarrator, status }] } }
    const items: any[] = data?.hadiths?.data ?? data?.hadiths ?? [];
    return items.slice(0, 10).map((item: any): IslamicResult => {
      const bookSlug = item.book?.bookSlug ?? item.bookSlug ?? "";
      const arabic   = item.hadithArabic ?? "";
      const urdu     = item.hadithUrdu ?? "";
      const english  = item.hadithEnglish ?? "";
      const parts    = [arabic, urdu, english].filter(Boolean).join("\n\n");
      return {
        domain: "hadith-api",
        content: parts,
        citation_ref: {
          collection:    item.book?.bookName ?? bookSlug,
          book:          bookSlug,
          hadith_number: item.hadithNumber,
          grade:         item.status,
          rawi:          item.englishNarrator,
          url:           `https://hadithapi.com/hadith/${bookSlug}/${item.hadithNumber}`,
        },
        language: lang,
      };
    });
  } catch {
    return [];
  }
}

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
    }));
  } catch {
    return [];
  }
}

serve(async (req) => {
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

    const SUNNAH_API_KEY  = Deno.env.get("SUNNAH_API_KEY") ?? "";
    const HADITH_API_KEY  = Deno.env.get("HADITH_API_KEY") ?? "";
    if (!SUNNAH_API_KEY) {
      console.warn("[islamic-api-fetch] SUNNAH_API_KEY not set — Sunnah.com lane is disabled. Add the secret inside the Lovable platform to enable it.");
    }
    if (!HADITH_API_KEY) {
      console.warn("[islamic-api-fetch] HADITH_API_KEY not set — HadithAPI.com (Urdu/EN/AR) lane is disabled. Add the secret inside the Lovable platform to enable it.");
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

    // Fan-out: only call selected domains
    const fetchers: Promise<IslamicResult[]>[] = [];

    if (!selectedDomains || selectedDomains.includes("dorar")) {
      fetchers.push(fetchWithCache("dorar", () => fetchDorar(query)));
    }
    if (!selectedDomains || selectedDomains.includes("alquran")) {
      fetchers.push(fetchWithCache("alquran", () => fetchAlQuran(query)));
    }
    if ((!selectedDomains || selectedDomains.includes("sunnah")) && SUNNAH_API_KEY) {
      fetchers.push(fetchWithCache("sunnah", () => fetchSunnah(query, SUNNAH_API_KEY)));
    }
    if ((!selectedDomains || selectedDomains.includes("hadith-api")) && HADITH_API_KEY) {
      fetchers.push(fetchWithCache("hadith-api", () => fetchHadithApi(query, HADITH_API_KEY)));
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
});
