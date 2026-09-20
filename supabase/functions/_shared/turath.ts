// Turath.io API response normalization and defensive parsing (ADR-0054).
//
// Turath endpoints (/search?q=...&ver=3, /page/..., /book/...) return records
// with a serialized JSON string in `meta`, HTML `<em>` highlight tags in `snip`,
// and no direct URL field. This module extracts bibliographic coordinates,
// sanitizes highlight markup, and maps records into stable citation structures.

export interface TurathMeta {
  headings?: string[];
  page_id?: number | string;
  page?: number | string;
  vol?: number | string;
  book_name?: string;
  author_name?: string;
  author_death?: number | string;
  category?: string;
  publisher?: string;
  year?: number | string;
  [key: string]: unknown;
}

export interface TurathRawSearchHit {
  book_id?: number | string;
  cat_id?: number | string;
  author_id?: number | string;
  meta?: string | TurathMeta;
  snip?: string;
  text?: string;
  [key: string]: unknown;
}

export interface TurathRawBook {
  book_id?: number | string;
  cat_id?: number | string;
  author_id?: number | string;
  name?: string;
  book_name?: string;
  author_name?: string;
  author?: string;
  category_name?: string;
  vol_count?: number | string;
  page_count?: number | string;
  meta?: string | Record<string, unknown>;
  [key: string]: unknown;
}

export interface TurathNormalizedResult {
  book_id: string;
  cat_id?: string;
  author_id?: string;
  book_name: string;
  author_name: string;
  page: number;
  vol: number;
  page_id?: number;
  headings: string[];
  snippet: string;
  text: string;
  citation_ref: {
    book_id: string;
    shamela_id: string;
    page: number;
    page_number: number;
    vol: number;
    volume: number;
    book: string;
    author: string;
    headings: string[];
    discipline: "classical";
  };
}

export interface TurathNormalizedBook {
  book_id: string;
  title: string;
  author: string;
  category: string;
  vol_count: number;
  page_count: number;
}

const safeNum = (v: unknown, fallback = 0): number => {
  if (typeof v === "number" && !Number.isNaN(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const parsed = Number(v.trim());
    if (!Number.isNaN(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

const safeStr = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
};

/** Strips `<em>` search highlights and other HTML tags while normalizing whitespace. */
export function stripTurathHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** Defensively parses the JSON string in `meta`. Never throws. */
export function parseTurathMeta(meta: unknown): TurathMeta {
  if (!meta) return {};
  if (typeof meta === "object" && meta !== null) return meta as TurathMeta;
  if (typeof meta === "string") {
    const trimmed = meta.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        return parsed as TurathMeta;
      }
    } catch {
      // Defensive fallback for corrupted meta JSON strings
    }
  }
  return {};
}

/** Normalizes a raw Turath search result into a typed bibliographic structure. */
export function normalizeTurathSearchHit(hit: TurathRawSearchHit): TurathNormalizedResult {
  const meta = parseTurathMeta(hit.meta);

  const bookIdStr = safeStr(hit.book_id || meta.book_id);
  const bookId = bookIdStr || "0";
  const bookName = safeStr(meta.book_name || hit.book_name || "كتاب مجهول");
  const authorName = safeStr(meta.author_name || hit.author_name || "مؤلف مجهول");
  const page = safeNum(meta.page ?? hit.page, 1);
  const vol = safeNum(meta.vol ?? hit.vol, 1);
  const pageId = meta.page_id != null ? safeNum(meta.page_id) : undefined;
  const headings = Array.isArray(meta.headings)
    ? meta.headings.map(safeStr).filter(Boolean)
    : [];

  const rawSnip = hit.snip ?? "";
  const rawText = hit.text ?? "";
  const snippet = stripTurathHtml(rawSnip) || stripTurathHtml(rawText).slice(0, 300);
  const text = stripTurathHtml(rawText) || snippet;

  return {
    book_id: bookId,
    cat_id: hit.cat_id != null ? safeStr(hit.cat_id) : undefined,
    author_id: hit.author_id != null ? safeStr(hit.author_id) : undefined,
    book_name: bookName,
    author_name: authorName,
    page,
    vol,
    page_id: pageId,
    headings,
    snippet,
    text,
    citation_ref: {
      book_id: bookId,
      shamela_id: bookId,
      page,
      page_number: page,
      vol,
      volume: vol,
      book: bookName,
      author: authorName,
      headings,
      discipline: "classical",
    },
  };
}

/** Normalizes a raw Turath book metadata response. */
export function normalizeTurathBook(book: TurathRawBook): TurathNormalizedBook {
  const meta = parseTurathMeta(book.meta);
  const bookId = safeStr(book.book_id || meta.book_id || "0");
  const title = safeStr(book.book_name || book.name || meta.book_name || "كتاب مجهول");
  const author = safeStr(book.author || book.author_name || meta.author_name || "مؤلف مجهول");
  const category = safeStr(book.category_name || meta.category || "عام");
  const volCount = safeNum(book.vol_count ?? meta.vol_count, 1);
  const pageCount = safeNum(book.page_count ?? meta.page_count, 0);

  return {
    book_id: bookId,
    title,
    author,
    category,
    vol_count: volCount,
    page_count: pageCount,
  };
}

// ─── Cloud Tier T Implementation ────────────────────────────────────────────

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
    title?: string;
    author?: string;
    url?: string;
    volume?: number;
    page?: number;
    _is_anchor?: boolean;
    discipline?: string;
    book_id?: string | number;
    shamela_id?: string | number;
    headings?: string[];
    [key: string]: unknown;
  };
  language: "ar" | "en" | "ur";
  has_matn?: boolean;
}

/** Detects discipline for a Turath book (fiqh/tafsir/nahw/rijal/classical). */
export function detectTurathDiscipline(
  bookName: string,
  category = "",
  headings: string[] = []
): "fiqh" | "tafsir" | "nahw" | "rijal" | "classical" {
  const target = `${bookName} ${category} ${headings.join(" ")}`.toLowerCase();

  // Tafsir
  if (/تفسير|تأويل|معاني القرآن|إعراب القرآن|الدر المنثور|جامع البيان|ابن كثير|القرطبي|الطبري|الكشاف/.test(target)) {
    return "tafsir";
  }

  // Fiqh
  if (/فقه|مبسوط|هداية|مغني|مجموع|منهاج|رد المحتار|الدر المختار|محتار|بدائع الصنائع|كتاب الصلاة|كتاب الطهارة|كتاب الزكاة|كتاب الصيام|كتاب النكاح|كتاب البيوع|أحكام|فتاوى|فتاوي|حنفي|شافعي|مالكي|حنبلي|روضة الطالبين|مختصر خليل|كشاف القناع|الإنصاف|الروض المربع|عمدة الفقه/.test(target)) {
    return "fiqh";
  }

  // Nahw / Lughat / Grammar
  if (/نحو|صرف|إعراب|ألفية|آجرومية|سيبويه|قطر الندى|مفصل|كافية|قاموس|معجم|لسان العرب|الصحاح|لغة/.test(target)) {
    return "nahw";
  }

  // Rijal / Biographies
  if (/رجال|جرح|تعديل|طبقات|تراجم|ثقات|ضعفاء|تهذيب|سير أعلام|وفيات|أنساب/.test(target)) {
    return "rijal";
  }

  return "classical";
}

interface MemoryCacheEntry {
  results: IslamicResult[];
  expiresAt: number;
}
const MEMORY_CACHE = new Map<string, MemoryCacheEntry>();
const MAX_MEMORY_CACHE_ENTRIES = 200;
const CLOUD_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function clearTurathCloudCache(): void {
  MEMORY_CACHE.clear();
}

export function isTurathEnabled(): boolean {
  try {
    // @ts-ignore: Deno global
    const denoVal = typeof Deno !== "undefined" && Deno.env ? Deno.env.get("TURATH_ENABLED") : undefined;
    // @ts-ignore: process global
    const nodeVal = typeof process !== "undefined" && process.env ? process.env.TURATH_ENABLED : undefined;
    const val = denoVal ?? nodeVal;
    if (val === undefined || val === null || val === "") return true;
    return val !== "false" && val !== "0" && String(val).toLowerCase() !== "off";
  } catch {
    return true;
  }
}

export interface SearchTurathCloudOptions {
  limit?: number;
  bookIds?: number[];
  signal?: AbortSignal;
  supabase?: any;
}

/**
 * Searches Turath.io classical library via pure fetch, returning IslamicResult[]
 * conforming to islamic-search contracts.
 */
export async function searchTurathCloud(
  query: string,
  options?: SearchTurathCloudOptions,
): Promise<IslamicResult[]> {
  if (!isTurathEnabled()) return [];
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];

  const limit = Math.max(1, options?.limit ?? 10);
  const scoped = (options?.bookIds ?? []).filter(Number.isFinite);
  const scopedKey = scoped.slice().sort((a, b) => a - b).join(",");
  const cacheKey = `turath:search:${cleanQuery.toLowerCase()}:${limit}:${scopedKey}`;

  // 1. Check in-memory cache
  const memCached = MEMORY_CACHE.get(cacheKey);
  if (memCached) {
    if (Date.now() < memCached.expiresAt) {
      return memCached.results;
    }
    MEMORY_CACHE.delete(cacheKey);
  }

  // 2. Check Supabase api_response_cache if available
  const supabase = options?.supabase;
  if (supabase) {
    try {
      const { data } = await supabase
        .from("api_response_cache")
        .select("response, expires_at")
        .eq("cache_key", cacheKey)
        .maybeSingle();

      if (data) {
        if (new Date(data.expires_at).getTime() > Date.now()) {
          const cached = data.response as IslamicResult[];
          MEMORY_CACHE.set(cacheKey, { results: cached, expiresAt: new Date(data.expires_at).getTime() });
          return cached;
        } else {
          // expired
          supabase.from("api_response_cache").delete().eq("cache_key", cacheKey).then(() => {});
        }
      }
    } catch {
      // Ignore cache query errors and continue to fetch
    }
  }

  // 3. Outbound fetch
  const url = `https://api.turath.io/search?q=${encodeURIComponent(cleanQuery)}&ver=3`;
  let rawData: unknown;
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: options?.signal,
      headers: {
        "User-Agent": "EasyEditor-CloudTierT/1.0",
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return [];
    }

    rawData = await res.json();
  } catch (err) {
    if (options?.signal?.aborted) {
      throw err;
    }
    return [];
  }

  const rawHits: TurathRawSearchHit[] = Array.isArray(rawData)
    ? (rawData as TurathRawSearchHit[])
    : rawData && typeof rawData === "object" && Array.isArray((rawData as { results?: unknown[] }).results)
    ? ((rawData as { results: TurathRawSearchHit[] }).results)
    : [];

  let normalized = rawHits.map(normalizeTurathSearchHit);
  if (scoped.length > 0) {
    normalized = normalized.filter((h) => scoped.includes(Number(h.book_id)));
  }

  const results: IslamicResult[] = normalized.slice(0, limit).map((h) => {
    const discipline = detectTurathDiscipline(h.book_name, h.cat_id ?? "", h.headings);
    return {
      domain: "turath",
      content: h.text || h.snippet,
      citation_ref: {
        book: h.book_name,
        author: h.author_name,
        book_id: h.book_id,
        shamela_id: h.book_id,
        page: h.page,
        page_number: h.page,
        volume: h.vol,
        vol: h.vol,
        url: `https://turath.io/book/${h.book_id}?page=${h.page}`,
        headings: h.headings,
        discipline,
      },
      language: "ar",
      has_matn: true,
    };
  });

  // Store in cache
  const expiresAt = Date.now() + CLOUD_CACHE_TTL_MS;
  if (MEMORY_CACHE.size >= MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = MEMORY_CACHE.keys().next().value;
    if (oldestKey) MEMORY_CACHE.delete(oldestKey);
  }
  MEMORY_CACHE.set(cacheKey, { results, expiresAt });

  if (supabase && results.length > 0) {
    try {
      await supabase.from("api_response_cache").upsert({
        cache_key: cacheKey,
        domain: "turath",
        response: results,
        expires_at: new Date(expiresAt).toISOString(),
      }, { onConflict: "cache_key" });
    } catch {
      // Ignore cache persistence errors
    }
  }

  return results;
}

