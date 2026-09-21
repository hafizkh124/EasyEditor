/**
 * A `fetch` fake that behaves like the REAL api.turath.io — path, parameter
 * names and status codes included.
 *
 * Why this exists: the first Turath tests mocked `fetch` with a function that
 * returned a canned body for ANY url. The desktop client was calling
 * `/page/<id>/<pg>` and `/book/<id>` — both HTTP 404 on the live API — and its
 * search parser never read the real `{count, data}` envelope, yet every test
 * passed. A mock that accepts any URL cannot catch a wrong URL. This one 404s
 * (with the real `{}` body) on anything the live server would.
 *
 * Verified live 2026-09-20 (ver=3):
 *   /search?q=            → 200 { count, data:[…] }          (0 hits: {count:0,data:[]})
 *   /page?book_id=&pg=    → 200 { meta:"<json>", text }      (out of range: 200 {})
 *   /book?id=             → 200 { meta:{ id, name, … } }     (unknown id: 404 {})
 *   /author?id=           → 200 { id, name, biography, death } (unknown id: 200 {})
 *   anything else, incl. /page/<id>/<pg> and /book/<id>       → 404 {}
 */
import { vi } from 'vitest';
import searchFixture from '../fixtures/turath/search.json';
import pageFixture from '../fixtures/turath/page.json';
import bookFixture from '../fixtures/turath/book.json';
import authorFixture from '../fixtures/turath/author.json';

export const FIXTURE_BOOK_ID = 127708;
export const FIXTURE_PAGE_ID = 10;

export interface TurathFakeOptions {
  /** Override the /search body (default: the real-envelope fixture). */
  search?: unknown;
  /** Force a status for every request, e.g. 503, to exercise failure paths. */
  forceStatus?: number;
  /** Extra headers on the forced-status response (e.g. Retry-After). */
  forceHeaders?: Record<string, string>;
}

export interface TurathCall {
  path: string;
  params: Record<string, string>;
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : status === 200 ? 'OK' : String(status),
    headers: { get: (k: string) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Returns the mock plus the recorded calls. Assign the mock to `global.fetch`. */
export function turathFetchFake(opts: TurathFakeOptions = {}) {
  const calls: TurathCall[] = [];
  const mock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const params = Object.fromEntries(url.searchParams.entries());
    calls.push({ path, params });

    if (opts.forceStatus != null) return respond(opts.forceStatus, {}, opts.forceHeaders);
    if (url.origin !== 'https://api.turath.io') return respond(404, {});

    switch (path) {
      case '/search':
        return respond(200, opts.search ?? searchFixture);
      case '/page': {
        const ok = Number(params.book_id) === FIXTURE_BOOK_ID && Number(params.pg) === FIXTURE_PAGE_ID;
        return respond(200, ok ? pageFixture : {});
      }
      case '/book':
        return Number(params.id) === FIXTURE_BOOK_ID ? respond(200, bookFixture) : respond(404, {});
      case '/author':
        return Number(params.id) === (authorFixture as { id: number }).id ? respond(200, authorFixture) : respond(200, {});
      default:
        return respond(404, {});
    }
  });
  return { fetch: mock, calls };
}
