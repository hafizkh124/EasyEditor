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
