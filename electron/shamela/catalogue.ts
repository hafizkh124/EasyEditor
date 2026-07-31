import Database from 'better-sqlite3';
import fs from 'node:fs';

export interface ShamelaBook {
  id: number;
  title: string;
  author: string | null;
  category: string | null;
  pageCount: number | null;
  volumeCount: number | null;
  info: string | null;
}

export interface ShamelaCategory {
  id: number;
  name: string;
  parentId: number | null;
  bookCount: number;
}

export interface CatalogueStats {
  totalBooks: number;
  totalAuthors: number;
  totalCategories: number;
}

let dbInstance: Database.Database | null = null;

export function getCatalogueDb(masterDbPath: string): Database.Database {
  if (dbInstance) return dbInstance;
  if (!fs.existsSync(masterDbPath)) {
    throw new Error(`Shamela master.db not found at: ${masterDbPath}`);
  }
  const db = new Database(masterDbPath, { readonly: true });
  db.pragma('journal_mode = WAL');
  dbInstance = db;
  return db;
}

export function closeCatalogueDb(): void {
  if (dbInstance) {
    try { dbInstance.close(); } catch {
      // ignore close errors
    }
    dbInstance = null;
  }
}

export function getCatalogueStats(masterDbPath: string): CatalogueStats {
  const db = getCatalogueDb(masterDbPath);
  let totalBooks = 0;
  let totalAuthors = 0;
  let totalCategories = 0;

  try {
    const r = db.prepare('SELECT COUNT(*) as count FROM book').get() as { count: number };
    totalBooks = r?.count ?? 0;
  } catch {
    // table may not exist in older schema
  }

  try {
    const r = db.prepare('SELECT COUNT(*) as count FROM author').get() as { count: number };
    totalAuthors = r?.count ?? 0;
  } catch {
    // table may not exist in older schema
  }

  try {
    const r = db.prepare('SELECT COUNT(*) as count FROM category').get() as { count: number };
    totalCategories = r?.count ?? 0;
  } catch {
    // table may not exist in older schema
  }

  return { totalBooks, totalAuthors, totalCategories };
}

export function searchBooks(
  masterDbPath: string,
  query: string,
  limit = 50,
  offset = 0,
): ShamelaBook[] {
  const db = getCatalogueDb(masterDbPath);
  try {
    const stmt = db.prepare(`
      SELECT b.id, b.title, a.name as author, c.name as category,
             b.page_count as pageCount, b.volume_count as volumeCount, b.info
      FROM book b
      LEFT JOIN author a ON b.author_id = a.id
      LEFT JOIN category c ON b.category_id = c.id
      WHERE b.title LIKE ? OR a.name LIKE ?
      ORDER BY b.title
      LIMIT ? OFFSET ?
    `);
    const pattern = `%${query}%`;
    return stmt.all(pattern, pattern, limit, offset) as ShamelaBook[];
  } catch (err) {
    console.warn('[catalogue] searchBooks query failed, trying fallback:', err);
    return searchBooksFallback(db, query, limit, offset);
  }
}

function searchBooksFallback(
  db: Database.Database,
  query: string,
  limit = 50,
  offset = 0,
): ShamelaBook[] {
  try {
    const stmt = db.prepare(`
      SELECT b.id, b.title, b.author as author, '' as category,
             b.pages as pageCount, b.volumes as volumeCount, b.info
      FROM book b
      WHERE b.title LIKE ? OR b.author LIKE ?
      ORDER BY b.title
      LIMIT ? OFFSET ?
    `);
    const pattern = `%${query}%`;
    return stmt.all(pattern, pattern, limit, offset) as ShamelaBook[];
  } catch {
    return [];
  }
}

export function listCategories(masterDbPath: string): ShamelaCategory[] {
  const db = getCatalogueDb(masterDbPath);
  try {
    const stmt = db.prepare(`
      SELECT c.id, c.name, c.parent_id as parentId,
             (SELECT COUNT(*) FROM book WHERE category_id = c.id) as bookCount
      FROM category c
      ORDER BY c.name
    `);
    return stmt.all() as ShamelaCategory[];
  } catch {
    return [];
  }
}

export function listBooksByCategory(
  masterDbPath: string,
  categoryId: number,
  limit = 50,
  offset = 0,
): ShamelaBook[] {
  const db = getCatalogueDb(masterDbPath);
  try {
    const stmt = db.prepare(`
      SELECT b.id, b.title, a.name as author, c.name as category,
             b.page_count as pageCount, b.volume_count as volumeCount, b.info
      FROM book b
      LEFT JOIN author a ON b.author_id = a.id
      LEFT JOIN category c ON b.category_id = c.id
      WHERE b.category_id = ?
      ORDER BY b.title
      LIMIT ? OFFSET ?
    `);
    return stmt.all(categoryId, limit, offset) as ShamelaBook[];
  } catch {
    return [];
  }
}
