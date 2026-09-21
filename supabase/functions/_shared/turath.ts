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

/**
 * Turath's `/page` response: `{ meta: "<JSON string>", text: "<plain text>" }`.
 * Unlike a search hit it carries NO `book_id` (the caller already knows it).
 */
export interface TurathRawPage {
  meta?: string | TurathMeta;
  text?: string;
  [key: string]: unknown;
}

/**
 * Turath's `/book` response: `{ meta: { id, name, author_id, cat_id, … } }`.
 * Note `meta` is a real object here, and there is no author NAME — only
 * `author_id`, which `/author` resolves.
 */
export interface TurathRawBook {
  meta?: {
    id?: number | string;
    name?: string;
    author_id?: number | string;
    cat_id?: number | string;
    info?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Turath's `/author` response. `death` is a hijri year in Arabic-Indic digits ("١٤٣٨"). */
export interface TurathRawAuthor {
  id?: number | string;
  name?: string;
  biography?: string;
  death?: number | string;
  [key: string]: unknown;
}

export interface TurathNormalizedResult {
  book_id: string;
  cat_id?: string;
  author_id?: string;
  book_name: string;
  author_name: string;
  /** PRINTED page number. Restarts in every volume — never an address. */
  page: number;
  /** Volume, or `undefined` when Turath gave a non-numeric one. */
  vol?: number;
  /** Sequential page index within the book. This is what `/page?pg=` and the
   *  reader's `?page=` take; it is unique per book, unlike `page`. */
  page_id?: number;
  headings: string[];
  snippet: string;
  text: string;
  citation_ref: {
    book_id: string;
    shamela_id: string;
    page: number;
    page_number: number;
    page_id?: number;
    vol?: number;
    volume?: number;
    book: string;
    author: string;
    headings: string[];
    discipline: "classical";
  };
}

export interface TurathNormalizedPage {
  book_id: string;
  book_name: string;
  author_name: string;
  page: number;
  vol?: number;
  page_id?: number;
  headings: string[];
  text: string;
  /** Human citation label, e.g. "ج2، ص129". */
  label: string;
}

export interface TurathNormalizedBook {
  book_id: string;
  title: string;
  author_id?: string;
  cat_id?: string;
}

export interface TurathNormalizedAuthor {
  id: string;
  name: string;
  /** Hijri death year, or null when absent or unparseable. */
  death_year: number | null;
}

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits → ASCII, so `Number()` can read them. */
const toAsciiDigits = (s: string): string =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

const safeNum = (v: unknown, fallback = 0): number => {
  if (typeof v === "number" && !Number.isNaN(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const parsed = Number(toAsciiDigits(v.trim()));
    if (v.trim() !== "" && !Number.isNaN(parsed)) return Math.trunc(parsed);
  }
  return fallback;
};

/** Like `safeNum` but distinguishes "not a number" from a real 0. */
const numOrUndef = (v: unknown): number | undefined => {
  const n = safeNum(v, Number.NaN);
  return Number.isNaN(n) ? undefined : n;
};

const safeStr = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
};

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
};

/**
 * Strips Turath's markup (`<em>` search highlights, `<span data-type="title">`
 * headings, `<s>`, `<hr>`) down to plain text.
 *
 * Tags are removed with NO replacement, not a space: a highlight can sit in the
 * middle of a word (`<em>ال</em>ربا`), and inserting a space there would split
 * one Arabic token into two — breaking both the model's reading and any later
 * quote verification. `<hr>`/`<br>` become a line break; line structure is kept
 * because these books are full of numbered lists (`١ - …`) that collapse into
 * an unreadable run if every newline is flattened.
 */
export function stripTurathHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<\s*(?:hr|br)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/g, (e) => HTML_ENTITIES[e] ?? e)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pulls the hit array out of a `/search` response.
 *
 * The real envelope is `{ count, data: [...] }`. Earlier code looked for a bare
 * array or `.results` only, so against the live API it found nothing and every
 * Turath search silently returned zero rows. Kept tolerant of the other two
 * shapes so a future API tweak degrades to "still works" instead of "empty".
 */
export function extractTurathHits(raw: unknown): TurathRawSearchHit[] {
  if (Array.isArray(raw)) return raw as TurathRawSearchHit[];
  if (raw && typeof raw === "object") {
    const o = raw as { data?: unknown; results?: unknown };
    if (Array.isArray(o.data)) return o.data as TurathRawSearchHit[];
    if (Array.isArray(o.results)) return o.results as TurathRawSearchHit[];
  }
  return [];
}

/**
 * The reader URL for a book, optionally deep-linked to a page.
 *
 * The reader's `?page=` takes the SEQUENTIAL page index (`page_id`), not the
 * printed page number — verified in the live reader: `?page=13` of book 127708
 * opens printed page ١/١٦, and the API says page_id 10 ↔ printed 13 in that
 * book, i.e. page_id 13 ↔ printed 16. Linking with the printed number would
 * open a different page of the book (off by the front-matter offset).
 *
 * Without a `page_id` this links the book alone rather than a guessed page —
 * a correct book link beats a confident wrong-page one.
 *
 * Host is `app.turath.io`: `turath.io/book/…` 302-redirects to the app root and
 * drops the book and page entirely.
 */
export function turathReaderUrl(bookId: string | number, pageId?: number): string {
  const base = `https://app.turath.io/book/${encodeURIComponent(String(bookId))}`;
  return pageId != null && Number.isFinite(pageId) && pageId > 0 ? `${base}?page=${pageId}` : base;
}

/** "ج2، ص129" — the printed coordinates a scholar actually cites. */
export function turathPageLabel(page: number, vol?: number): string {
  return vol != null ? `ج${vol}، ص${page}` : `ص${page}`;
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
  const vol = numOrUndef(meta.vol ?? hit.vol);
  const pageId = numOrUndef(meta.page_id);
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
      page_id: pageId,
      vol,
      volume: vol,
      book: bookName,
      author: authorName,
      headings,
      discipline: "classical",
    },
  };
}

/**
 * Normalizes a `/page` response. `bookId` comes from the caller because the
 * page's own `meta` has no `book_id`.
 */
export function normalizeTurathPage(raw: TurathRawPage, bookId: string): TurathNormalizedPage {
  const meta = parseTurathMeta(raw.meta);
  const page = safeNum(meta.page, 1);
  const vol = numOrUndef(meta.vol);
  return {
    book_id: bookId,
    book_name: safeStr(meta.book_name || "كتاب مجهول"),
    author_name: safeStr(meta.author_name || "مؤلف مجهول"),
    page,
    vol,
    page_id: numOrUndef(meta.page_id),
    headings: Array.isArray(meta.headings) ? meta.headings.map(safeStr).filter(Boolean) : [],
    text: stripTurathHtml(raw.text),
    label: turathPageLabel(page, vol),
  };
}

/** Normalizes a `/book` response (`{ meta: { id, name, author_id, cat_id, … } }`). */
export function normalizeTurathBook(book: TurathRawBook): TurathNormalizedBook {
  const meta = book?.meta ?? {};
  return {
    book_id: safeStr(meta.id ?? "0") || "0",
    title: safeStr(meta.name || "كتاب مجهول"),
    author_id: meta.author_id != null ? safeStr(meta.author_id) : undefined,
    cat_id: meta.cat_id != null ? safeStr(meta.cat_id) : undefined,
  };
}

/** Normalizes an `/author` response. An unknown id returns `{}` with HTTP 200. */
export function normalizeTurathAuthor(raw: TurathRawAuthor): TurathNormalizedAuthor {
  const death = numOrUndef(raw?.death);
  return {
    id: safeStr(raw?.id ?? ""),
    name: safeStr(raw?.name ?? ""),
    death_year: death != null && death > 0 ? death : null,
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
    vol?: number;
    page?: number;
    page_id?: number;
    page_number?: number;
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
  // `v2`: the cached row shape changed (page_id, app.turath.io URLs). A key
  // bump retires any row written under the old shape instead of serving it.
  const cacheKey = `turath:v2:search:${cleanQuery.toLowerCase()}:${limit}:${scopedKey}`;

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

  let normalized = extractTurathHits(rawData).map(normalizeTurathSearchHit);
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
        page_id: h.page_id,
        volume: h.vol,
        vol: h.vol,
        url: turathReaderUrl(h.book_id, h.page_id),
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


// ─── Tier T trigger ─────────────────────────────────────────────────────────

/**
 * Query-planner disciplines for which Tier T (Turath) is worth calling.
 *
 * Every entry must be a real `Discipline` slug (disciplines.ts) — the planner
 * can only ever emit those. An earlier version listed "seerah", which is not a
 * slug, so that branch could never fire and the prompt it was meant to serve
 * (`seerat_alam`) silently never reached Turath. A test now cross-checks this
 * list against DISCIPLINE_SLUGS.
 *
 * Only disciplines where Turath ADDS coverage the local corpus lacks:
 *  - fiqh / fatwa / lughat / nahw — the local classical corpus is empty (or, for
 *    fatwa, Urdu-only), and a live probe (2026-09-20) returned relevant classical
 *    passages: fiqh works for "حكم بيع المعاطاة", Ibn Jibrin's fatawa for
 *    "حكم التأمين التجاري", commentaries discussing the i'rab of the hadith
 *    "إنما الأعمال بالنيات".
 *  - tafsir / rijal / hadith_term are LEFT OUT. The local corpus already holds
 *    real data for them (6,208 tafsir rows, 19,616 rijal bios), and Turath's raw
 *    full-text match is noisy there: "تفسير آية الكرسي" returned manuscript
 *    catalogue entries, "ترجمة سفيان الثوري" returned Tuhfat al-Ashraf hadith
 *    entries that merely cite his name. Rank fusion does not judge relevance, so
 *    those rows would displace good local ones. They stay reachable by picking
 *    the `turath` domain explicitly.
 */
export const TURATH_DISCIPLINES = ["fiqh", "fatwa", "lughat", "nahw"] as const;

/**
 * Whether Tier T should run for this request:
 *  - EXPLICIT: the user picked the `turath` domain, or
 *  - IMPLICIT: the query planner detected one of TURATH_DISCIPLINES.
 */
export function shouldQueryTurath(disciplines: readonly string[], selectedDomains: unknown): boolean {
  if (Array.isArray(selectedDomains) && selectedDomains.includes("turath")) return true;
  return disciplines.some((d) => (TURATH_DISCIPLINES as readonly string[]).includes(d));
}
