/**
 * Connectors Hub (Phase 8, ADR-0044; ADR-0054) — the local-first Shamela router.
 *
 * The agent calls ONE `search_shamela` / `read_shamela_page` / `find_shamela_book`
 * tool; this decides the transport:
 *   1. LOCAL (electron/shamela/shamelaNative.ts) if the local connector is on —
 *      a SUCCESS (even zero hits) is a legitimate answer and is returned.
 *   2. CLOUD (electron/shamela/cloudClient.ts) when local is OFF or ERRORS.
 *   3. TURATH (electron/shamela/turathClient.ts) when cloud is OFF or ERRORS.
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
import { searchTurath, readTurathPage, findTurathBook } from '../../shamela/turathClient.js';

const log = logger.child('agent/shamelaRouter');

export type ShamelaTransport = 'local' | 'cloud' | 'turath' | 'none';

export interface RouteOpts {
  localEnabled: boolean;
  cloudEnabled: boolean;
  turathEnabled?: boolean;
  /** For read: which transport's id space the source_id came from. */
  preferTransport?: 'local' | 'cloud' | 'turath';
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

export async function routeShamelaSearch(
  query: string,
  limit: number,
  opts: RouteOpts,
  /** Plan §4.5 — restrict results to these Shamela book ids ("best effort":
   *  the Lucene helper has no bookId filter, so this over-fetches then filters). */
  bookIds?: number[],
): Promise<SearchRoute> {
  const scoped = (bookIds ?? []).filter(Number.isFinite);
  const fetchLimit = scoped.length ? Math.min(limit * 6, 90) : limit;
  const applyScope = (hits: ShamelaSearchResult[]): ShamelaSearchResult[] =>
    scoped.length ? hits.filter((h) => scoped.includes(Number(h.bookId))).slice(0, limit) : hits;
  const scopeNote = scoped.length ? 'دائرہ: نتائج منتخب کتب تک محدود (تخمینی)۔' : undefined;

  let localErr: unknown;
  if (opts.localEnabled) {
    try {
      const hits = applyScope(await searchShamelaNative(query, fetchLimit));
      return { hits, transport: 'local', note: scopeNote }; // success — even 0 hits — wins
    } catch (e) {
      localErr = e;
      log.warn('local Shamela search failed', { message: errMsg(e) });
    }
  }
  let cloudErr: unknown;
  if (opts.cloudEnabled) {
    try {
      const hits = applyScope(await searchCloud(query, fetchLimit));
      return {
        hits,
        transport: 'cloud',
        note: localErr ? 'المكتبة المحلية غير متاحة — تم البحث في شامله لنک' : scopeNote,
      };
    } catch (e) {
      cloudErr = e;
      log.warn('cloud Shamela search failed', { message: errMsg(e) });
    }
  }
  let turathErr: unknown;
  if (opts.turathEnabled) {
    try {
      const hits = applyScope(await searchTurath(query, fetchLimit, scoped.length ? scoped : undefined));
      const fallbackNote = localErr || cloudErr
        ? 'تم البحث عبر Turath.io كبديل'
        : scopeNote;
      return {
        hits,
        transport: 'turath',
        note: fallbackNote,
      };
    } catch (e) {
      turathErr = e;
      log.warn('turath search failed', { message: errMsg(e) });
    }
  }

  const errs = [localErr, cloudErr, turathErr].filter(Boolean);
  if (errs.length > 0) {
    if (localErr && !cloudErr && !turathErr && !opts.cloudEnabled && !opts.turathEnabled) {
      return { hits: [], transport: 'none', error: `Shamela (local) failed: ${errMsg(localErr)}` };
    }
    return { hits: [], transport: 'none', error: `Shamela search failed: ${errs.map(errMsg).join(' / ')}` };
  }
  return { hits: [], transport: 'none', error: 'Shamela is not available — enable the local, شامله لنک, or Turath connector.' };
}

export async function routeShamelaReadPage(bookId: string, page: number, opts: RouteOpts): Promise<PageRoute> {
  const order: Array<'local' | 'cloud' | 'turath'> =
    opts.preferTransport === 'turath'
      ? ['turath', 'local', 'cloud']
      : opts.preferTransport === 'cloud'
      ? ['cloud', 'local', 'turath']
      : ['local', 'cloud', 'turath'];
  let lastErr: unknown;
  for (const t of order) {
    if (t === 'local' && !opts.localEnabled) continue;
    if (t === 'cloud' && !opts.cloudEnabled) continue;
    if (t === 'turath' && !opts.turathEnabled) continue;
    try {
      const pc =
        t === 'local'
          ? await readShamelaPage(bookId, page)
          : t === 'cloud'
          ? await readCloudPage(bookId, page)
          : await readTurathPage(bookId, page);
      return { page: pc, transport: t };
    } catch (e) {
      lastErr = e;
      log.warn(`${t} Shamela readPage failed`, { message: errMsg(e) });
    }
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
  let localErr: unknown;
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
        localErr = e;
        log.warn('local Shamela catalogue search failed', { message: errMsg(e) });
      }
    }
  }
  let cloudErr: unknown;
  if (opts.cloudEnabled) {
    try {
      const books: CloudBook[] = await findCloudBook(query);
      return { books, transport: 'cloud' };
    } catch (e) {
      cloudErr = e;
      log.warn('cloud Shamela findBook failed', { message: errMsg(e) });
    }
  }
  let turathErr: unknown;
  if (opts.turathEnabled) {
    try {
      const books: CloudBook[] = await findTurathBook(query);
      return { books, transport: 'turath' };
    } catch (e) {
      turathErr = e;
      log.warn('turath findBook failed', { message: errMsg(e) });
    }
  }

  const errs = [localErr, cloudErr, turathErr].filter(Boolean);
  if (errs.length > 0) {
    return { books: [], transport: 'none', error: `book lookup failed: ${errs.map(errMsg).join(' / ')}` };
  }

  return {
    books: [], transport: 'none',
    error: opts.localEnabled
      ? 'The local Shamela catalogue is not available (no master.db) — enable شامله لنک or Turath for book lookup.'
      : 'Shamela is not available — enable the local, شامله لنک, or Turath connector.',
  };
}

/** Test seam. */
export function _resetRouterCache(): void {
  cachedMasterDbPath = undefined;
}
