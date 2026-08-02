import Database from 'better-sqlite3';
import fs from 'node:fs';

/**
 * Catalogue access to Shamela 4's `database/master.db`.
 *
 * The real schema (verified against D:\shamela4 on 2026-08-02) is:
 *   category(category_id, category_name, category_order)
 *   book(book_id, book_name, book_category, book_type, book_date, authors,
 *        main_author, printed, group_id, hidden, ...)
 *   author(author_id, author_name, death_number, death_text, alpha)
 *   author_book(author_id, book_id)
 *
 * Earlier versions of this file queried an invented schema (b.id / c.parent_id
 * / a.name) and silently returned empty lists for every call. Every query
 * below is written against the schema above.
 */

export interface ShamelaBook {
  id: number;
  title: string;
  author: string | null;
  category: string | null;
  /** Author's death year (AH, Hijri). 99999 = unknown. */
  deathYear: number | null;
  bookType: number | null;
  info: string | null;
}

export interface ShamelaCategory {
  id: number;
  name: string;
  parentId: number | null;
  bookCount: number;
}

export interface ShamelaAuthor {
  id: number;
  name: string;
  deathNumber: number | null;
  deathText: string | null;
  bookCount: number;
}

export interface ShamelaPeriod {
  /** Century index: 0 = pre-Islamic/negative dates, 1..15 = 1st..15th AH. */
  century: number;
  label: string;
  bookCount: number;
}

export interface CatalogueStats {
  totalBooks: number;
  totalAuthors: number;
  totalCategories: number;
}

let dbInstance: Database.Database | null = null;
let dbPath: string | null = null;

export function getCatalogueDb(masterDbPath: string): Database.Database {
  if (dbInstance && dbPath === masterDbPath) return dbInstance;
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
    dbInstance = null;
  }
  if (!fs.existsSync(masterDbPath)) {
    throw new Error(`Shamela master.db not found at: ${masterDbPath}`);
  }
  const db = new Database(masterDbPath, { readonly: true });
  db.pragma('journal_mode = WAL');
  dbInstance = db;
  dbPath = masterDbPath;
  return db;
}

export function closeCatalogueDb(): void {
  if (dbInstance) {
    try { dbInstance.close(); } catch { /* ignore */ }
    dbInstance = null;
    dbPath = null;
  }
}

const BOOK_SELECT = `
  SELECT b.book_id as id, b.book_name as title,
         COALESCE(a.author_name, b.authors) as author,
         c.category_name as category,
         b.book_date as deathYear,
         b.book_type as bookType,
         b.meta_data as info
  FROM book b
  LEFT JOIN author a ON b.main_author = a.author_id
  LEFT JOIN category c ON b.book_category = c.category_id
`;

function mapBook(row: any): ShamelaBook {
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    category: row.category ?? null,
    deathYear: row.deathYear ?? null,
    bookType: row.bookType ?? null,
    info: row.info ?? null,
  };
}

export function getCatalogueStats(masterDbPath: string): CatalogueStats {
  const db = getCatalogueDb(masterDbPath);
  let totalBooks = 0;
  let totalAuthors = 0;
  let totalCategories = 0;
  try {
    totalBooks = (db.prepare('SELECT COUNT(*) as count FROM book').get() as { count: number })?.count ?? 0;
  } catch { /* schema drift */ }
  try {
    totalAuthors = (db.prepare('SELECT COUNT(*) as count FROM author').get() as { count: number })?.count ?? 0;
  } catch { /* schema drift */ }
  try {
    totalCategories = (db.prepare('SELECT COUNT(*) as count FROM category').get() as { count: number })?.count ?? 0;
  } catch { /* schema drift */ }
  return { totalBooks, totalAuthors, totalCategories };
}

export function searchBooks(
  masterDbPath: string,
  query: string,
  limit = 50,
  offset = 0,
): ShamelaBook[] {
  const db = getCatalogueDb(masterDbPath);
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    ${BOOK_SELECT}
    WHERE b.hidden = 0
      AND (b.book_name LIKE ? OR a.author_name LIKE ? OR b.authors LIKE ? OR c.category_name LIKE ?)
    ORDER BY b.book_name
    LIMIT ? OFFSET ?
  `).all(pattern, pattern, pattern, pattern, limit, offset) as any[];
  return rows.map(mapBook);
}

/**
 * The category tree. The real master.db has a single flat `category` table
 * (no parent column), so `parentId` is always null and every category is a
 * top-level node. Shamela's app presents these same 41 categories.
 */
export function listCategories(masterDbPath: string): ShamelaCategory[] {
  const db = getCatalogueDb(masterDbPath);
  const rows = db.prepare(`
    SELECT c.category_id as id, c.category_name as name,
           NULL as parentId,
           (SELECT COUNT(*) FROM book b WHERE b.book_category = c.category_id AND b.hidden = 0) as bookCount
    FROM category c
    WHERE c.category_id != 42
    ORDER BY c.category_order
  `).all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    bookCount: r.bookCount ?? 0,
  }));
}

export function listBooksByCategory(
  masterDbPath: string,
  categoryId: number,
  limit = 50,
  offset = 0,
): ShamelaBook[] {
  const db = getCatalogueDb(masterDbPath);
  const rows = db.prepare(`
    ${BOOK_SELECT}
    WHERE b.hidden = 0 AND b.book_category = ?
    ORDER BY b.book_name
    LIMIT ? OFFSET ?
  `).all(categoryId, limit, offset) as any[];
  return rows.map(mapBook);
}

export function listAuthors(
  masterDbPath: string,
  limit = 50,
  offset = 0,
): ShamelaAuthor[] {
  const db = getCatalogueDb(masterDbPath);
  const rows = db.prepare(`
    SELECT a.author_id as id, a.author_name as name,
           a.death_number as deathNumber, a.death_text as deathText,
           (SELECT COUNT(*) FROM book b WHERE b.main_author = a.author_id AND b.hidden = 0) as bookCount
    FROM author a
    ORDER BY a.author_name
    LIMIT ? OFFSET ?
  `).all(limit, offset) as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    deathNumber: r.deathNumber ?? null,
    deathText: r.deathText ?? null,
    bookCount: r.bookCount ?? 0,
  }));
}

export function searchAuthors(
  masterDbPath: string,
  query: string,
  limit = 50,
  offset = 0,
): ShamelaAuthor[] {
  const db = getCatalogueDb(masterDbPath);
  const pattern = `%${query}%`;
  const rows = db.prepare(`
    SELECT a.author_id as id, a.author_name as name,
           a.death_number as deathNumber, a.death_text as deathText,
           (SELECT COUNT(*) FROM book b WHERE b.main_author = a.author_id AND b.hidden = 0) as bookCount
    FROM author a
    WHERE a.author_name LIKE ?
    ORDER BY a.author_name
    LIMIT ? OFFSET ?
  `).all(pattern, limit, offset) as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    deathNumber: r.deathNumber ?? null,
    deathText: r.deathText ?? null,
    bookCount: r.bookCount ?? 0,
  }));
}

export function listBooksByAuthor(
  masterDbPath: string,
  authorId: number,
  limit = 50,
  offset = 0,
): ShamelaBook[] {
  const db = getCatalogueDb(masterDbPath);
  // Some books are co-authored; author_book covers those too. Prefer
  // main_author rows, then author_book, deduplicated by book_id.
  const rows = db.prepare(`
    SELECT b.book_id as id, b.book_name as title,
           COALESCE(a.author_name, b.authors) as author,
           c.category_name as category,
           b.book_date as deathYear,
           b.book_type as bookType,
           b.meta_data as info
    FROM book b
    LEFT JOIN author a ON b.main_author = a.author_id
    LEFT JOIN category c ON b.book_category = c.category_id
    WHERE b.hidden = 0 AND b.book_id IN (
      SELECT book_id FROM author_book WHERE author_id = ?
      UNION
      SELECT book_id FROM book WHERE main_author = ?
    )
    ORDER BY b.book_name
    LIMIT ? OFFSET ?
  `).all(authorId, authorId, limit, offset) as any[];
  return rows.map(mapBook);
}

/**
 * Period buckets by author death century. `book_date` == the main author's
 * death year (AH). 99999 = unknown, negatives = pre-Islamic. Buckets align
 * with how Shamela groups books by era (القرن).
 */
export function listPeriods(masterDbPath: string): ShamelaPeriod[] {
  const db = getCatalogueDb(masterDbPath);
  const rows = db.prepare(`
    SELECT
      CASE
        WHEN b.book_date <= 0 THEN 0
        WHEN b.book_date >= 99999 THEN 16
        ELSE (b.book_date / 100) + 1
      END as century,
      COUNT(*) as bookCount
    FROM book b
    WHERE b.hidden = 0
    GROUP BY century
  `).all() as any[];

  const labels: Record<number, string> = {
    0: 'قبل الإسلام / صدر الإسلام',
    1: 'القرن الأول',
    2: 'القرن الثاني',
    3: 'القرن الثالث',
    4: 'القرن الرابع',
    5: 'القرن الخامس',
    6: 'القرن السادس',
    7: 'القرن السابع',
    8: 'القرن الثامن',
    9: 'القرن التاسع',
    10: 'القرن العاشر',
    11: 'القرن الحادي عشر',
    12: 'القرن الثاني عشر',
    13: 'القرن الثالث عشر',
    14: 'القرن الرابع عشر',
    15: 'القرن الخامس عشر',
    16: 'بدون تاريخ',
  };

  return rows
    .map((r) => ({
      century: r.century,
      label: labels[r.century] ?? `القرن ${r.century}`,
      bookCount: r.bookCount,
    }))
    .filter((p) => p.century !== 16 || true);
}

export function listBooksByPeriod(
  masterDbPath: string,
  century: number,
  limit = 50,
  offset = 0,
): ShamelaBook[] {
  const db = getCatalogueDb(masterDbPath);
  const clause =
    century <= 0
      ? 'b.book_date <= 0'
      : century >= 16
        ? 'b.book_date >= 99999'
        : `b.book_date > ${(century - 1) * 100} AND b.book_date <= ${century * 100}`;
  const rows = db.prepare(`
    ${BOOK_SELECT}
    WHERE b.hidden = 0 AND ${clause}
    ORDER BY b.book_name
    LIMIT ? OFFSET ?
  `).all(limit, offset) as any[];
  return rows.map(mapBook);
}
