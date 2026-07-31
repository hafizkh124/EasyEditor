// Import cost estimate for Shamela books (SPEC-M5 FR-5.4, SPEC-M5.9 FR-2.2).
//
// Risk R7 is that "import my library" quietly runs up the user's own Gemini
// bill: 40,000 books is millions of embedding calls. The only defence the
// spec accepts is a mandatory, aggregate, up-front estimate — so this has to
// answer BEFORE any text is read or any request leaves the machine.
//
// It therefore works from the catalogue's page counts alone. That makes it
// approximate, which is the right trade: an estimate that costs a full read
// of every selected book would be the very expense it is meant to preview.

import { getCatalogueDb } from './catalogue.js';
import { CHUNK_SIZE, CHUNK_OVERLAP } from '../../shared/text/documentChunks.js';

/**
 * Rough characters per Shamela page. Pages are short — a printed page of
 * classical Arabic with apparatus — so this deliberately leans high; an
 * estimate that under-promises spend is worse than one that over-promises.
 */
const CHARS_PER_PAGE = 1800;

export interface BookEstimate {
  bookId: number;
  title: string;
  author: string | null;
  pageCount: number;
  estimatedChunks: number;
}

export interface ImportEstimate {
  books: BookEstimate[];
  totalBooks: number;
  totalPages: number;
  /** One embedding request per chunk — the unit the user is billed in. */
  totalChunks: number;
  /** True when any selected book had no page count to work from. */
  approximate: boolean;
}

/** Chunks a document of `chars` produces, mirroring chunkDocumentText's stride. */
export function estimateChunksForChars(chars: number): number {
  if (chars <= 0) return 0;
  if (chars <= CHUNK_SIZE) return 1;
  const stride = CHUNK_SIZE - CHUNK_OVERLAP;
  return Math.ceil((chars - CHUNK_OVERLAP) / stride);
}

export function estimateImport(masterDbPath: string, bookIds: number[]): ImportEstimate {
  const db = getCatalogueDb(masterDbPath);
  const books: BookEstimate[] = [];
  let approximate = false;

  for (const bookId of bookIds) {
    const row = readBookMeta(db, bookId);
    const pageCount = row?.pageCount ?? 0;
    if (!row?.pageCount) approximate = true;

    books.push({
      bookId,
      title: row?.title ?? `#${bookId}`,
      author: row?.author ?? null,
      pageCount,
      estimatedChunks: estimateChunksForChars(pageCount * CHARS_PER_PAGE),
    });
  }

  return {
    books,
    totalBooks: books.length,
    totalPages: books.reduce((sum, b) => sum + b.pageCount, 0),
    totalChunks: books.reduce((sum, b) => sum + b.estimatedChunks, 0),
    approximate,
  };
}

/**
 * Shamela's master.db schema varies between installs (risk R16), so the
 * modern column names are tried first and the older flat ones second.
 */
function readBookMeta(
  db: ReturnType<typeof getCatalogueDb>,
  bookId: number,
): { title: string; author: string | null; pageCount: number | null } | null {
  try {
    return db.prepare(`
      SELECT b.title, a.name as author, b.page_count as pageCount
      FROM book b LEFT JOIN author a ON b.author_id = a.id
      WHERE b.id = ?
    `).get(bookId) as { title: string; author: string | null; pageCount: number | null } | null;
  } catch {
    try {
      return db.prepare('SELECT title, author, pages as pageCount FROM book WHERE id = ?')
        .get(bookId) as { title: string; author: string | null; pageCount: number | null } | null;
    } catch {
      return null;
    }
  }
}
