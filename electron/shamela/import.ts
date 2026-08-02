// Per-book import from a local Shamela 4 library (SPEC-M5 FR-5.4, SPEC-M5.9 FR-2.4).
//
// The imported text joins the same local corpus as an uploaded PDF — same
// chunks table, same vectors, same retrieval — so a citation from Shamela and
// one from the user's own library are answered by one search, not two.
//
// What makes a Shamela citation different is provenance: every chunk carries
// the page and volume it came from, which is why library_chunks has
// page_number/part_number columns. Without them the citation could name the
// book but not where in it, and "کتاب + جلد + صفحہ" is the exit criterion.
//
// Shamela's own files are only ever read (risk R17/FR-2.8): the Lucene index
// is opened read-only by the Java helper and master.db through better-sqlite3
// in readonly mode. Nothing here writes to the user's Shamela install.

import type { SqliteDatabase } from '../db/open.js';
import { getCurrentUserId } from '../db/workspaceStore/identity.js';
import { createItem } from '../db/workspaceStore/library.js';
import { storeChunk } from '../db/ingest.js';
import { embedTextContent } from '../ai/geminiClient.js';
import { readShamelaBook } from './shamelaNative.js';
import { chunkDocumentText } from '../../shared/text/documentChunks.js';

export interface ImportProgress {
  bookId: number;
  title: string;
  /** 1-based position in the selection, for "کتاب ۲ از ۵". */
  bookIndex: number;
  totalBooks: number;
  pagesRead: number;
  chunksStored: number;
  status: 'reading' | 'embedding' | 'done' | 'cancelled' | 'failed';
  error?: string;
}

export interface ImportBooksArgs {
  db: SqliteDatabase;
  books: Array<{ id: number; title: string; author?: string | null }>;
  onProgress?: (progress: ImportProgress) => void;
  signal?: { aborted: boolean };
}

export interface ImportBooksResult {
  imported: number;
  cancelled: boolean;
  items: Array<{ bookId: number; libraryItemId: string; chunks: number }>;
}

/** Shamela stores page text as HTML; the corpus wants prose. */
function toPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Returns the library item for a book already imported, or null. */
export function findImportedItem(db: SqliteDatabase, bookId: number): string | null {
  const userId = getCurrentUserId(db);
  const row = db
    .prepare(`SELECT id FROM library_items
              WHERE user_id = ?
                AND json_extract(source_ref, '$.shamelaBookId') = ?`)
    .get(userId, bookId) as { id: string } | undefined;
  return row?.id ?? null;
}

/** Book ids from the given list that are already in the local corpus (FR-2.6). */
export function filterAlreadyImported(db: SqliteDatabase, bookIds: number[]): number[] {
  return bookIds.filter((id) => findImportedItem(db, id) !== null);
}

/**
 * Imports the selected books, one at a time.
 *
 * A book is committed page by page rather than all at once, so cancelling
 * mid-import keeps the books already finished — re-importing the rest later
 * costs only what was not done (FR-2.5).
 */
export async function importShamelaBooks({
  db, books, onProgress, signal,
}: ImportBooksArgs): Promise<ImportBooksResult> {
  const userId = getCurrentUserId(db);
  const items: ImportBooksResult['items'] = [];
  let cancelled = false;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];

    if (signal?.aborted) { cancelled = true; break; }

    // FR-2.6: never spend twice on the same book.
    if (findImportedItem(db, book.id)) continue;

    const base = { bookId: book.id, title: book.title, bookIndex: i + 1, totalBooks: books.length };
    onProgress?.({ ...base, pagesRead: 0, chunksStored: 0, status: 'reading' });

    // `kind` stays "book": Postgres constrains it to a fixed set and the local
    // schema is kept in sync with it, so a Shamela-only kind would make the
    // two diverge for no gain. Provenance lives in source_ref.shamelaBookId,
    // which is what findImportedItem matches on.
    const item = createItem(db, {
      title: book.title,
      kind: 'book',
      source_ref: { shamelaBookId: book.id, title: book.title, author: book.author ?? null },
      meta: { ingest: { status: 'embedding', progress: 0 } },
    });

    let pagesRead = 0;
    let chunksStored = 0;
    let chunkIndex = 0;

    try {
      // One JVM for the whole book (risk N4). Pages are collected first
      // because embedding is async and readShamelaBook's callback is not —
      // a book's raw text is on the order of a megabyte, so holding it while
      // the far slower embedding pass runs is not the cost worth avoiding.
      const pages: Array<{ page: string; text: string }> = [];
      await readShamelaBook(String(book.id), (page) => {
        if (signal?.aborted) return false;
        pages.push(page);
        return true;
      });

      for (const page of pages) {
        if (signal?.aborted) { cancelled = true; break; }

        pagesRead++;
        const text = toPlainText(page.text);
        if (!text) continue;

        const pageNumber = Number.parseInt(page.page, 10);
        const partNumber = Number.NaN;

        for (const chunk of chunkDocumentText(text)) {
          if (signal?.aborted) { cancelled = true; break; }

          const embedding = await embedTextContent(chunk.content);
          storeChunk({
            db,
            userId,
            itemId: item.id,
            chunk: { ...chunk, index: chunkIndex++ },
            embedding,
            pageNumber: Number.isNaN(pageNumber) ? null : pageNumber,
            partNumber: Number.isNaN(partNumber) ? null : partNumber,
          });
          chunksStored++;
        }

        onProgress?.({ ...base, pagesRead, chunksStored, status: 'embedding' });
      }

      markItem(db, item.id, cancelled ? 'embedding' : 'ready', chunksStored);
      items.push({ bookId: book.id, libraryItemId: item.id, chunks: chunksStored });
      onProgress?.({ ...base, pagesRead, chunksStored, status: cancelled ? 'cancelled' : 'done' });

      if (cancelled) break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      markItem(db, item.id, 'failed', chunksStored, message);
      onProgress?.({ ...base, pagesRead, chunksStored, status: 'failed', error: message });
      throw err;
    }
  }

  return { imported: items.length, cancelled, items };
}

function markItem(
  db: SqliteDatabase,
  itemId: string,
  status: string,
  totalChunks: number,
  error?: string,
): void {
  const row = db.prepare('SELECT meta FROM library_items WHERE id = ?').get(itemId) as
    | { meta: string }
    | undefined;
  let meta: Record<string, unknown> = {};
  try { meta = JSON.parse(row?.meta || '{}'); } catch { meta = {}; }

  db.prepare('UPDATE library_items SET meta = ? WHERE id = ?').run(
    JSON.stringify({
      ...meta,
      ingest: {
        status,
        total_chunks: totalChunks,
        progress: status === 'ready' ? 100 : 0,
        ...(error ? { error } : {}),
      },
    }),
    itemId,
  );
}
