// @vitest-environment node
// electron/agent/adapters/shamelaRouter.ts (ADR-0044) — local-first, cloud
// fallback ONLY on local OFF or local ERROR (a local zero-hit is a real answer).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const native = {
  searchShamelaNative: vi.fn(async () => [
    { bookId: '55', bookTitle: 'صحيح البخاري', pageNumber: 40, snippet: 'إنما الأعمال', score: 1 },
  ]),
  readShamelaPage: vi.fn(async () => ({ bookId: '55', pageNumber: 40, text: 'نص محلي', footnotes: undefined })),
  detectShamelaInstallation: vi.fn(
    async (): Promise<{ installed: boolean; path: string | null; masterDbPath: string | null }> =>
      ({ installed: true, path: 'D:\\shamela4', masterDbPath: 'D:\\shamela4\\database\\master.db' }),
  ),
};
vi.mock('../../electron/shamela/shamelaNative.ts', () => native);

const cloud = {
  searchCloud: vi.fn(async () => [
    { bookId: '900', bookTitle: 'فتح الباري', pageNumber: 12, snippet: 'سحابي', score: 1 },
  ]),
  readCloudPage: vi.fn(async () => ({ bookId: '900', pageNumber: 12, text: 'نص سحابي', footnotes: undefined })),
  findCloudBook: vi.fn(async () => [{ id: 900, title: 'فتح الباري', author: 'ابن حجر', deathYear: 852 }]),
};
vi.mock('../../electron/shamela/cloudClient.ts', () => cloud);

const catalogue = { searchBooks: vi.fn(() => [{ id: 55, title: 'صحيح البخاري', author: 'البخاري', category: null, deathYear: 256, bookType: null, info: null }]) };
vi.mock('../../electron/shamela/catalogue.ts', () => catalogue);

let mod: typeof import('../../electron/agent/adapters/shamelaRouter');

beforeEach(async () => {
  vi.clearAllMocks();
  mod = await import('../../electron/agent/adapters/shamelaRouter');
  mod._resetRouterCache();
});

const both = { localEnabled: true, cloudEnabled: true };

describe('routeShamelaSearch', () => {
  it('local hits → local; cloud not touched', async () => {
    const r = await mod.routeShamelaSearch('نية', 8, both);
    expect(r.transport).toBe('local');
    expect(r.hits).toHaveLength(1);
    expect(cloud.searchCloud).not.toHaveBeenCalled();
  });

  it('local returns ZERO hits → still local (the trigger decision), no cloud call', async () => {
    native.searchShamelaNative.mockResolvedValueOnce([]);
    const r = await mod.routeShamelaSearch('nope', 8, both);
    expect(r.transport).toBe('local');
    expect(r.hits).toEqual([]);
    expect(cloud.searchCloud).not.toHaveBeenCalled();
  });

  it('local THROWS + cloud on → cloud, with a note', async () => {
    native.searchShamelaNative.mockRejectedValueOnce(new Error('JRE missing'));
    const r = await mod.routeShamelaSearch('نية', 8, both);
    expect(r.transport).toBe('cloud');
    expect(r.note).toMatch(/شامله لنک/);
  });

  it('local OFF + cloud on → straight to cloud', async () => {
    const r = await mod.routeShamelaSearch('نية', 8, { localEnabled: false, cloudEnabled: true });
    expect(r.transport).toBe('cloud');
    expect(native.searchShamelaNative).not.toHaveBeenCalled();
  });

  it('both off → transport none + error', async () => {
    const r = await mod.routeShamelaSearch('نية', 8, { localEnabled: false, cloudEnabled: false });
    expect(r.transport).toBe('none');
    expect(r.error).toBeTruthy();
  });

  it('local throws + cloud also throws → transport none + combined error', async () => {
    native.searchShamelaNative.mockRejectedValueOnce(new Error('local dead'));
    cloud.searchCloud.mockRejectedValueOnce(new Error('cloud dead'));
    const r = await mod.routeShamelaSearch('نية', 8, both);
    expect(r.transport).toBe('none');
    expect(r.error).toMatch(/local dead.*cloud dead|cloud dead/);
  });
});

describe('routeShamelaReadPage', () => {
  it('preferTransport local → local read', async () => {
    const r = await mod.routeShamelaReadPage('55', 40, { ...both, preferTransport: 'local' });
    expect(r.transport).toBe('local');
    expect(r.page?.text).toBe('نص محلي');
  });
  it('preferTransport cloud → cloud read first', async () => {
    const r = await mod.routeShamelaReadPage('900', 12, { ...both, preferTransport: 'cloud' });
    expect(r.transport).toBe('cloud');
    expect(cloud.readCloudPage).toHaveBeenCalled();
  });
  it('cloud-prefixed id but cloud disabled → falls back to local', async () => {
    const r = await mod.routeShamelaReadPage('55', 40, { localEnabled: true, cloudEnabled: false, preferTransport: 'cloud' });
    expect(r.transport).toBe('local');
  });
});

describe('routeShamelaFindBook', () => {
  it('local with a masterDbPath → catalogue.searchBooks', async () => {
    const r = await mod.routeShamelaFindBook('بخاري', both);
    expect(r.transport).toBe('local');
    expect(catalogue.searchBooks).toHaveBeenCalled();
    expect(r.books[0].id).toBe(55);
  });
  it('no masterDbPath → cloud', async () => {
    native.detectShamelaInstallation.mockResolvedValueOnce({ installed: false, path: null, masterDbPath: null });
    mod._resetRouterCache();
    const r = await mod.routeShamelaFindBook('بخاري', both);
    expect(r.transport).toBe('cloud');
    expect(cloud.findCloudBook).toHaveBeenCalled();
  });
});
