/**
 * Connectors Hub (Phase 8, ADR-0044) — the local-first Shamela router.
 *
 * The agent calls ONE `search_shamela` / `read_shamela_page` / `find_shamela_book`
 * tool; this decides the transport:
 *   1. LOCAL (electron/shamela/shamelaNative.ts) if the local connector is on —
 *      a SUCCESS (even zero hits) is a legitimate answer and is returned.
 *   2. CLOUD (electron/shamela/cloudClient.ts) only when local is OFF or ERRORS.
 * The `transport` on the result drives the `[ماخذ: 💻 …]` / `[ماخذ: ☁️ …]` chip.
 */
import { logger } from '../../lib/logger.js';
import {
  searchShamelaNative,
  readShamelaPage,
  detectShamelaInstallation,
  type ShamelaSearchResult,
  type ShamelaPageContent,
} from '../../shamela/shamelaNative.js';
import { searchCloud, readCloudPage, findCloudBook, type CloudBook } from '../../shamela/cloudClient.js';

const log = logger.child('agent/shamelaRouter');

export type ShamelaTransport = 'local' | 'cloud' | 'none';

export interface RouteOpts {
  localEnabled: boolean;
  cloudEnabled: boolean;
  /** For read: which transport's id space the source_id came from. */
  preferTransport?: 'local' | 'cloud';
}

export interface SearchRoute {
  hits: ShamelaSearchResult[];
  transport: ShamelaTransport;
  note?: string;
  error?: string;
}
export interface PageRoute {
  page?: ShamelaPageContent;
  transport: ShamelaTransport;
  error?: string;
}
export interface BookRoute {
  books: Array<{ id: number; title: string; author: string | null; deathYear: number | null }>;
  transport: ShamelaTransport;
  note?: string;
  error?: string;
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function routeShamelaSearch(query: string, limit: number, opts: RouteOpts): Promise<SearchRoute> {
  let localErr: unknown;
  if (opts.localEnabled) {
    try {
      const hits = await searchShamelaNative(query, limit);
      return { hits, transport: 'local' }; // success — even 0 hits — wins
    } catch (e) {
      localErr = e;
      log.warn('local Shamela search failed', { message: errMsg(e) });
    }
  }
  if (opts.cloudEnabled) {
    try {
      const hits = await searchCloud(query, limit);
      return {
        hits,
        transport: 'cloud',
        note: localErr ? 'المكتبة المحلية غير متاحة — تم البحث في شامله لنک' : undefined,
      };
    } catch (e) {
      const both = localErr ? `${errMsg(localErr)} / ${errMsg(e)}` : errMsg(e);
      return { hits: [], transport: 'none', error: `Shamela search failed: ${both}` };
    }
  }
  if (localErr) return { hits: [], transport: 'none', error: `Shamela (local) failed: ${errMsg(localErr)}` };
  return { hits: [], transport: 'none', error: 'Shamela is not available — enable the local or the شامله لنک connector.' };
}

export async function routeShamelaReadPage(bookId: string, page: number, opts: RouteOpts): Promise<PageRoute> {
  const order: Array<'local' | 'cloud'> =
    opts.preferTransport === 'cloud' ? ['cloud', 'local'] : ['local', 'cloud'];
  let lastErr: unknown;
  for (const t of order) {
    if (t === 'local' && !opts.localEnabled) continue;
    if (t === 'cloud' && !opts.cloudEnabled) continue;
    try {
      const pc = t === 'local' ? await readShamelaPage(bookId, page) : await readCloudPage(bookId, page);
      return { page: pc, transport: t };
    } catch (e) { lastErr = e; log.warn(`${t} Shamela readPage failed`, { message: errMsg(e) }); }
  }
  return { transport: 'none', error: lastErr ? `could not read the page: ${errMsg(lastErr)}` : 'Shamela is not available.' };
}

let cachedMasterDbPath: string | null | undefined;

async function masterDbPath(): Promise<string | null> {
  if (cachedMasterDbPath !== undefined) return cachedMasterDbPath;
  try {
    const s = await detectShamelaInstallation();
    cachedMasterDbPath = s.installed ? (s.masterDbPath ?? null) : null;
  } catch {
    cachedMasterDbPath = null;
  }
  return cachedMasterDbPath;
}

export async function routeShamelaFindBook(query: string, opts: RouteOpts): Promise<BookRoute> {
  if (opts.localEnabled) {
    const db = await masterDbPath();
    if (db) {
      try {
        const { searchBooks } = await import('../../shamela/catalogue.js');
        const books = searchBooks(db, query, 15).map((b) => ({
          id: b.id, title: b.title, author: b.author, deathYear: b.deathYear,
        }));
        return { books, transport: 'local' };
      } catch (e) {
        log.warn('local Shamela catalogue search failed', { message: errMsg(e) });
      }
    }
  }
  if (opts.cloudEnabled) {
    try {
      const books: CloudBook[] = await findCloudBook(query);
      return { books, transport: 'cloud' };
    } catch (e) {
      return { books: [], transport: 'none', error: `book lookup failed: ${errMsg(e)}` };
    }
  }
  return {
    books: [], transport: 'none',
    error: opts.localEnabled
      ? 'The local Shamela catalogue is not available (no master.db) — enable شامله لنک for book lookup.'
      : 'Shamela is not available — enable the local or the شامله لنک connector.',
  };
}

/** Test seam. */
export function _resetRouterCache(): void {
  cachedMasterDbPath = undefined;
}
