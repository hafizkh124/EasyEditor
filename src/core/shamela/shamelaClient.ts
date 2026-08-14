/**
 * Transport-agnostic Shamela 4 catalogue client (UX-v1 P7).
 *
 * `useCatalogueBrowser` used to call `window.electronAPI.shamela.*` directly,
 * which is why Browse could never work on the web build — there is no main
 * process there to ask. This follows the same adapter shape as `getBackend()`
 * (ADR-0006): one interface, two transports, chosen once, so a consumer never
 * branches on runtime itself.
 *
 * Scope, deliberately: catalogue browsing only (categories, authors, periods,
 * books-by-X, stats). The Reader (readPage/readToc/pageCount) is NOT covered
 * here. `shamela-mcp` — the package `tools/shamela-bridge` wraps — addresses
 * pages by an opaque `page_id` documented as distinct from the printed page
 * number, and exposes no page-count equivalent at all; the native Electron
 * reader (`electron/shamela/shamelaNative.ts`, ADR-0007) uses simple
 * sequential numbers via a completely different code path (Shamela's own
 * Java reading engine). Whether the two schemes are compatible cannot be
 * verified without a live installation to test against, and guessing wrong
 * would ship a broken reader rather than an honestly-absent one — so Reader
 * stays desktop-only for now (`useReaderState.ts` is unchanged and already
 * degrades gracefully off-desktop). Revisit once that can be tested for real.
 *
 * `masterDbPath` is deliberately absent from this interface. The desktop
 * transport resolves and caches it once via `detect()`, threading it into the
 * IPC calls that need it; the bridge transport doesn't need it at all — the
 * companion process already knows its own database.
 */
import { isDesktop } from "@/utils/environment";

export interface ShamelaDetectResult {
  available: boolean;
  reason?: string;
}

export interface CatalogueStats {
  totalBooks: number;
  totalAuthors: number;
  totalCategories: number;
}

export interface CatalogueBook {
  id: number;
  title: string;
  author: string | null;
  category: string | null;
  deathYear: number | null;
  bookType: number | null;
}

export interface CatalogueCategory {
  id: number;
  name: string;
  bookCount: number;
}

export interface CatalogueAuthor {
  id: number;
  name: string;
  deathNumber: number | null;
  deathText: string | null;
  bookCount: number;
  alpha: number | null;
}

export interface CataloguePeriod {
  century: number;
  label: string;
  bookCount: number;
}

export interface ShamelaClient {
  detect(): Promise<ShamelaDetectResult>;
  catalogueStats(): Promise<CatalogueStats>;
  listCategories(): Promise<CatalogueCategory[]>;
  booksByCategory(categoryId: number, limit?: number, offset?: number): Promise<CatalogueBook[]>;
  /** Web transport: only returns results for a non-empty query — the
   *  underlying package has no "list all ~3,100 authors" method, only a
   *  Lucene-backed name search. Desktop is unaffected (it lists all). */
  authors(limit?: number, offset?: number): Promise<CatalogueAuthor[]>;
  searchAuthors(query: string, limit?: number, offset?: number): Promise<CatalogueAuthor[]>;
  booksByAuthor(authorId: number, limit?: number, offset?: number): Promise<CatalogueBook[]>;
  periods(): Promise<CataloguePeriod[]>;
  booksByPeriod(century: number, limit?: number, offset?: number): Promise<CatalogueBook[]>;
}

// ─── Desktop transport — Electron IPC, main process → Shamela's own JRE ────

function createElectronClient(): ShamelaClient {
  // Resolved once and reused: every catalogue call needs the master.db path,
  // and re-running detect() per call would re-walk the filesystem for no
  // reason — the path cannot change without the app restarting.
  let masterDbPathPromise: Promise<string | null> | null = null;

  const resolveMasterDbPath = (): Promise<string | null> => {
    if (!masterDbPathPromise) {
      masterDbPathPromise = window.electronAPI!.shamela
        .detect()
        .then((state) => (state?.installed && state.masterDbPath ? state.masterDbPath : null))
        .catch(() => null);
    }
    return masterDbPathPromise;
  };

  const withMasterDb = async <T>(
    fn: (masterDbPath: string, api: NonNullable<typeof window.electronAPI>["shamela"]) => Promise<T>,
    empty: T,
  ): Promise<T> => {
    const masterDbPath = await resolveMasterDbPath();
    const api = window.electronAPI?.shamela;
    if (!masterDbPath || !api) return empty;
    return fn(masterDbPath, api);
  };

  return {
    async detect() {
      const state = await window.electronAPI!.shamela.detect();
      return {
        available: Boolean(state?.installed && state.masterDbPath),
        reason: state?.reason,
      };
    },
    catalogueStats: () => withMasterDb((p, api) => api.catalogueStats(p), { totalBooks: 0, totalAuthors: 0, totalCategories: 0 }),
    listCategories: () => withMasterDb((p, api) => api.listCategories(p), []),
    booksByCategory: (categoryId, limit, offset) =>
      withMasterDb((p, api) => api.booksByCategory(p, categoryId, limit, offset), []),
    authors: (limit, offset) => withMasterDb((p, api) => api.authors(p, limit, offset), []),
    searchAuthors: (query, limit, offset) => withMasterDb((p, api) => api.searchAuthors(p, query, limit, offset), []),
    booksByAuthor: (authorId, limit, offset) => withMasterDb((p, api) => api.booksByAuthor(p, authorId, limit, offset), []),
    periods: () => withMasterDb((p, api) => api.periods(p), []),
    booksByPeriod: (century, limit, offset) => withMasterDb((p, api) => api.booksByPeriod(p, century, limit, offset), []),
  };
}

// ─── Web transport — the tools/shamela-bridge HTTP companion ───────────────

function bridgeBaseUrl(): string {
  const raw = localStorage.getItem("shamela.mcp_url") || "http://127.0.0.1:8000";
  return raw.replace(/\/+$/, "");
}

async function bridgeFetch<T>(path: string, empty: T): Promise<T> {
  try {
    const res = await fetch(`${bridgeBaseUrl()}${path}`);
    if (!res.ok) return empty;
    return (await res.json()) as T;
  } catch {
    return empty;
  }
}

function createBridgeClient(): ShamelaClient {
  return {
    async detect() {
      try {
        const res = await fetch(`${bridgeBaseUrl()}/health`);
        if (!res.ok) return { available: false, reason: "Local companion did not respond." };
        const data = await res.json();
        return { available: data?.status === "ok" || data?.status === "degraded" };
      } catch {
        return { available: false, reason: "Local companion is not running." };
      }
    },
    catalogueStats: () => bridgeFetch("/catalogue/stats", { totalBooks: 0, totalAuthors: 0, totalCategories: 0 }),
    listCategories: () => bridgeFetch("/catalogue/categories", []),
    booksByCategory: (categoryId, limit = 100, offset = 0) =>
      bridgeFetch(`/catalogue/books?categoryId=${categoryId}&limit=${limit}&offset=${offset}`, []),
    authors: (limit = 100, offset = 0) => bridgeFetch(`/catalogue/authors?limit=${limit}&offset=${offset}`, []),
    searchAuthors: (query, limit = 100, offset = 0) =>
      bridgeFetch(`/catalogue/authors?q=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`, []),
    booksByAuthor: (authorId, limit = 100, offset = 0) =>
      bridgeFetch(`/catalogue/books?authorId=${authorId}&limit=${limit}&offset=${offset}`, []),
    periods: () => bridgeFetch("/catalogue/periods", []),
    booksByPeriod: (century, limit = 100, offset = 0) =>
      bridgeFetch(`/catalogue/books?century=${century}&limit=${limit}&offset=${offset}`, []),
  };
}

// ─── Selection ───────────────────────────────────────────────────────────

let cachedClient: ShamelaClient | null = null;
let cachedFor: "desktop" | "web" | null = null;

/**
 * The one place that decides which transport to use. Desktop always has the
 * native IPC bridge; web only has one once `useLocalShamela`'s connect flow
 * has stored `shamela.connected` — this must be checked at call time, not
 * cached across a whole session, since the user can connect the companion
 * after the app has already loaded.
 */
export function getShamelaClient(): ShamelaClient {
  const target = isDesktop() ? "desktop" : "web";
  if (cachedClient && cachedFor === target) return cachedClient;
  cachedClient = target === "desktop" ? createElectronClient() : createBridgeClient();
  cachedFor = target;
  return cachedClient;
}

/** Web only: is a companion actually connected right now, per `useLocalShamela`. */
export function isBridgeConnected(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("shamela.connected") === "1";
  } catch {
    return false;
  }
}
