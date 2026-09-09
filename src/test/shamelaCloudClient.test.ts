// @vitest-environment node
// electron/shamela/cloudClient.ts (ADR-0044) — the MCP client over the OAuth
// transport. The SDK + the OAuth provider/loopback are mocked; this pins the
// client's own logic: the UnauthorizedError → finishAuth → reconnect dance,
// the result normalisers (structured rows AND a text blob), the 429 message,
// and that pingCloud never builds a transport without a saved account.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── mock the MCP SDK ─────────────────────────────────────────────────────
class UnauthorizedError extends Error {
  constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError'; }
}

/** Per-test script for successive `client.connect()` calls. */
let connectScript: Array<'ok' | 'unauth' | Error> = [];
let callToolImpl: (name: string, args: unknown) => Promise<unknown> = async () => ({ content: [] });
let listToolsImpl: () => Promise<unknown> = async () => ({ tools: [] });
let pingImpl: () => Promise<void> = async () => {};

const transportsMade: FakeTransport[] = [];

class FakeTransport {
  url: string;
  finishAuth = vi.fn(async (_code: string) => {});
  close = vi.fn(async () => {});
  constructor(url: URL) { this.url = url.toString(); transportsMade.push(this); }
}

class FakeClient {
  async connect(_t: FakeTransport) {
    const step = connectScript.shift() ?? 'ok';
    if (step === 'unauth') throw new UnauthorizedError();
    if (step instanceof Error) throw step;
  }
  async listTools() { return listToolsImpl(); }
  async callTool({ name, arguments: args }: { name: string; arguments: unknown }) { return callToolImpl(name, args); }
  async ping() { return pingImpl(); }
  async close() {}
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: FakeClient }));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: FakeTransport }));
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({ UnauthorizedError }));

// ── mock the OAuth provider + loopback ───────────────────────────────────
const providerInvalidate = vi.fn();
class FakeProvider { invalidateCredentials = providerInvalidate; }

const oauth = {
  ShamelaCloudOAuthProvider: FakeProvider,
  waitForLoopbackCode: vi.fn(async () => 'THECODE'),
  stopLoopbackServer: vi.fn(),
  hasSavedAccount: vi.fn(() => true),
  isFlowPending: vi.fn(() => false),
  abortFlow: vi.fn(),
};
vi.mock('../../electron/shamela/cloudOAuth.ts', () => oauth);

let mod: typeof import('../../electron/shamela/cloudClient');

beforeEach(async () => {
  vi.clearAllMocks();
  connectScript = [];
  transportsMade.length = 0;
  callToolImpl = async () => ({ content: [] });
  listToolsImpl = async () => ({ tools: [] });
  pingImpl = async () => {};
  oauth.hasSavedAccount.mockReturnValue(true);
  oauth.isFlowPending.mockReturnValue(false);
  oauth.waitForLoopbackCode.mockResolvedValue('THECODE');
  mod = await import('../../electron/shamela/cloudClient');
  await mod.disconnectCloud();
});

describe('connectCloud', () => {
  it('connects on the first try when already authorized', async () => {
    connectScript = ['ok'];
    await mod.connectCloud();
    expect(mod.cloudStatus().connected).toBe(true);
    expect(transportsMade).toHaveLength(1);
  });

  it('runs the OAuth dance on UnauthorizedError: waits for the code, finishes auth, reconnects', async () => {
    connectScript = ['unauth', 'ok'];
    await mod.connectCloud();
    expect(oauth.waitForLoopbackCode).toHaveBeenCalled();
    expect(transportsMade[0].finishAuth).toHaveBeenCalledWith('THECODE');
    expect(transportsMade).toHaveLength(2);
    expect(mod.cloudStatus().connected).toBe(true);
  });

  it('a non-auth connect error propagates and leaves no session', async () => {
    connectScript = [new Error('network down')];
    await expect(mod.connectCloud()).rejects.toThrow(/network down/);
    expect(mod.cloudStatus().connected).toBe(false);
  });

  it('de-dupes concurrent callers', async () => {
    connectScript = ['ok'];
    await Promise.all([mod.connectCloud(), mod.connectCloud(), mod.connectCloud()]);
    expect(transportsMade).toHaveLength(1);
  });
});

describe('searchCloud normalisers', () => {
  it('maps structuredContent rows to ShamelaSearchResult', async () => {
    connectScript = ['ok'];
    callToolImpl = async (name) => {
      expect(name).toBe('shamela_search_pages');
      return {
        structuredContent: {
          results: [
            { book_id: 55, book_name: 'صحيح البخاري', page: 40, content: '<b>إنما</b> الأعمال', score: 3 },
          ],
        },
      };
    };
    const rows = await mod.searchCloud('نية', 8);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bookId: '55', bookTitle: 'صحيح البخاري', pageNumber: 40, score: 3 });
    expect(rows[0].snippet).toBe('إنما الأعمال'); // tags stripped, whitespace collapsed
  });

  it('a text-only blob degrades to one bibliographic-ish chunk (page 0, hashed id)', async () => {
    connectScript = ['ok'];
    callToolImpl = async () => ({ content: [{ type: 'text', text: 'نص حر بلا بيانات منظمة' }] });
    const rows = await mod.searchCloud('x', 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].pageNumber).toBe(0);
    expect(rows[0].bookId).toMatch(/^h[0-9a-f]{10}$/);
  });

  it('an empty result is an empty array', async () => {
    connectScript = ['ok'];
    callToolImpl = async () => ({ content: [] });
    expect(await mod.searchCloud('x', 5)).toEqual([]);
  });
});

describe('callCloud error mapping', () => {
  it('a 429 becomes a quota message, no retry', async () => {
    connectScript = ['ok'];
    const spy = vi.fn(async () => { throw new Error('HTTP 429 Too Many Requests'); });
    callToolImpl = spy;
    await expect(mod.searchCloud('x', 5)).rejects.toThrow(/الحصة/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a mid-run UnauthorizedError → "reconnect" message + session dropped, no browser pop', async () => {
    connectScript = ['ok'];
    callToolImpl = async () => { throw new UnauthorizedError(); };
    await expect(mod.searchCloud('x', 5)).rejects.toThrow(/انتهت الجلسة/);
    expect(mod.cloudStatus().connected).toBe(false);
    expect(oauth.waitForLoopbackCode).not.toHaveBeenCalled();
  });
});

describe('readCloudPage / findCloudBook', () => {
  it('readCloudPage strips tags and carries footnotes', async () => {
    connectScript = ['ok'];
    callToolImpl = async (name, args) => {
      expect(name).toBe('shamela_get_page');
      expect(args).toMatchObject({ book_id: 55, page: 40 });
      return { structuredContent: { page: 40, text: '<p>متن الصفحة</p>', footnotes: '(1) حاشية' } };
    };
    const p = await mod.readCloudPage('55', 40);
    expect(p.pageNumber).toBe(40);
    expect(p.text).toContain('متن الصفحة');
    expect(p.footnotes).toBe('(1) حاشية');
  });

  it('findCloudBook maps rows to CloudBook[]', async () => {
    connectScript = ['ok'];
    callToolImpl = async () => ({ structuredContent: { books: [{ id: 900, title: 'فتح الباري', author: 'ابن حجر', death_year: 852 }] } });
    const books = await mod.findCloudBook('فتح');
    expect(books[0]).toEqual({ id: 900, title: 'فتح الباري', author: 'ابن حجر', deathYear: 852 });
  });
});

describe('pingCloud (never interactive, never connects)', () => {
  it('no saved account → ok:null (a set-up state, not an error), no transport built', async () => {
    oauth.hasSavedAccount.mockReturnValue(false);
    const r = await mod.pingCloud();
    expect(r.ok).toBe(null);
    expect(r.detail).toMatch(/sign in/i);
    expect(transportsMade).toHaveLength(0);
  });

  it('account linked but no live session → ok:null, and it does NOT call connectCloud', async () => {
    oauth.hasSavedAccount.mockReturnValue(true);
    connectScript = ['unauth']; // would throw / go interactive if pingCloud connected
    const r = await mod.pingCloud();
    expect(r.ok).toBe(null);
    expect(oauth.waitForLoopbackCode).not.toHaveBeenCalled();
    expect(transportsMade).toHaveLength(0);
  });

  it('an established session that answers ping → ok:true with a latency', async () => {
    connectScript = ['ok'];
    await mod.connectCloud();
    transportsMade.length = 0;
    const r = await mod.pingCloud();
    expect(r.ok).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
    expect(transportsMade).toHaveLength(0); // reused the session, no new transport
  });

  it('an established session that stops answering → ok:false (a real failure)', async () => {
    connectScript = ['ok'];
    await mod.connectCloud();
    pingImpl = async () => { throw new Error('socket hang up'); };
    const r = await mod.pingCloud();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/socket hang up/);
  });
});

describe('signOutCloud', () => {
  it('disconnects and invalidates every credential', async () => {
    connectScript = ['ok'];
    await mod.connectCloud();
    await mod.signOutCloud();
    expect(mod.cloudStatus().connected).toBe(false);
    expect(providerInvalidate).toHaveBeenCalledWith('all');
  });
});

describe('the provisional tool list', () => {
  it('is non-empty (the live OAuth test pins the real names)', () => {
    expect(mod._CLOUD_TOOL_NAMES.length).toBeGreaterThan(0);
    expect(mod._CLOUD_TOOL_NAMES).toContain('shamela_search_pages');
  });
});
