// @vitest-environment node
// electron/agent/adapters/shamelaRouter.ts (ADR-0044, ADR-0054) — three-tier routing:
// local-first -> cloud fallback -> turath fallback.
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

const turath = {
  searchTurath: vi.fn(async () => [
    { bookId: '2166', bookTitle: 'المبسوط', pageNumber: 12, snippet: 'تراثي', score: 1 },
  ]),
  readTurathPage: vi.fn(async () => ({ bookId: '2166', pageNumber: 12, text: 'نص تراثي', footnotes: undefined })),
  findTurathBook: vi.fn(async () => [{ id: 2166, title: 'المبسوط', author: 'السرخسي', deathYear: 483 }]),
};
vi.mock('../../electron/shamela/turathClient.ts', () => turath);

const catalogue = { searchBooks: vi.fn(() => [{ id: 55, title: 'صحيح البخاري', author: 'البخاري', category: null, deathYear: 256, bookType: null, info: null }]) };
vi.mock('../../electron/shamela/catalogue.ts', () => catalogue);

let mod: typeof import('../../electron/agent/adapters/shamelaRouter');

beforeEach(async () => {
  vi.clearAllMocks();
  mod = await import('../../electron/agent/adapters/shamelaRouter');
  mod._resetRouterCache();
});

const both = { localEnabled: true, cloudEnabled: true };
const allThree = { localEnabled: true, cloudEnabled: true, turathEnabled: true };

describe('routeShamelaSearch', () => {
  it('local hits → local; cloud and turath not touched', async () => {
    const r = await mod.routeShamelaSearch('نية', 8, allThree);
    expect(r.transport).toBe('local');
    expect(r.hits).toHaveLength(1);
    expect(cloud.searchCloud).not.toHaveBeenCalled();
    expect(turath.searchTurath).not.toHaveBeenCalled();
  });

  it('local returns ZERO hits → still local (the trigger decision), no cloud or turath call', async () => {
    native.searchShamelaNative.mockResolvedValueOnce([]);
    const r = await mod.routeShamelaSearch('nope', 8, allThree);
    expect(r.transport).toBe('local');
    expect(r.hits).toEqual([]);
    expect(cloud.searchCloud).not.toHaveBeenCalled();
    expect(turath.searchTurath).not.toHaveBeenCalled();
  });

  it('local THROWS + cloud on → cloud, with a note', async () => {
    native.searchShamelaNative.mockRejectedValueOnce(new Error('JRE missing'));
    const r = await mod.routeShamelaSearch('نية', 8, both);
    expect(r.transport).toBe('cloud');
    expect(r.note).toMatch(/شامله لنک/);
    expect(turath.searchTurath).not.toHaveBeenCalled();
  });

  it('local OFF + cloud on → straight to cloud', async () => {
    const r = await mod.routeShamelaSearch('نية', 8, { localEnabled: false, cloudEnabled: true });
    expect(r.transport).toBe('cloud');
    expect(native.searchShamelaNative).not.toHaveBeenCalled();
    expect(turath.searchTurath).not.toHaveBeenCalled();
  });

  it('both off → transport none + error', async () => {
    const r = await mod.routeShamelaSearch('نية', 8, { localEnabled: false, cloudEnabled: false });
    expect(r.transport).toBe('none');
    expect(r.error).toBeTruthy();
  });

  it('local throws + cloud also throws → transport none + combined error when turath disabled', async () => {
    native.searchShamelaNative.mockRejectedValueOnce(new Error('local dead'));
    cloud.searchCloud.mockRejectedValueOnce(new Error('cloud dead'));
    const r = await mod.routeShamelaSearch('نية', 8, both);
    expect(r.transport).toBe('none');
    expect(r.error).toMatch(/local dead.*cloud dead|cloud dead/);
    expect(turath.searchTurath).not.toHaveBeenCalled();
  });

  it('local THROWS + cloud THROWS + turath ON → falls back to turath', async () => {
    native.searchShamelaNative.mockRejectedValueOnce(new Error('local dead'));
    cloud.searchCloud.mockRejectedValueOnce(new Error('cloud dead'));
    const r = await mod.routeShamelaSearch('نية', 8, allThree);
    expect(r.transport).toBe('turath');
    expect(r.hits[0].bookId).toBe('2166');
    expect(r.note).toMatch(/Turath\.io|تراث/);
    expect(turath.searchTurath).toHaveBeenCalled();
  });

  it('local OFF + cloud OFF + turath ON → routes directly to turath', async () => {
    const r = await mod.routeShamelaSearch('طهارة', 8, {
      localEnabled: false,
      cloudEnabled: false,
      turathEnabled: true,
    });
    expect(r.transport).toBe('turath');
    expect(r.hits).toHaveLength(1);
    expect(native.searchShamelaNative).not.toHaveBeenCalled();
    expect(cloud.searchCloud).not.toHaveBeenCalled();
    expect(turath.searchTurath).toHaveBeenCalled();
  });

  it('all three throw → transport none with three-part error', async () => {
    native.searchShamelaNative.mockRejectedValueOnce(new Error('local err'));
    cloud.searchCloud.mockRejectedValueOnce(new Error('cloud err'));
    turath.searchTurath.mockRejectedValueOnce(new Error('turath err'));
    const r = await mod.routeShamelaSearch('طهارة', 8, allThree);
    expect(r.transport).toBe('none');
    expect(r.error).toMatch(/local err.*cloud err.*turath err/);
  });
});

describe('routeShamelaReadPage', () => {
  it('preferTransport local → local read', async () => {
    const r = await mod.routeShamelaReadPage('55', 40, { ...allThree, preferTransport: 'local' });
    expect(r.transport).toBe('local');
    expect(r.page?.text).toBe('نص محلي');
  });

  it('preferTransport cloud → cloud read first', async () => {
    const r = await mod.routeShamelaReadPage('900', 12, { ...allThree, preferTransport: 'cloud' });
    expect(r.transport).toBe('cloud');
    expect(cloud.readCloudPage).toHaveBeenCalled();
  });

  it('preferTransport turath → turath read first', async () => {
    const r = await mod.routeShamelaReadPage('2166', 12, { ...allThree, preferTransport: 'turath' });
    expect(r.transport).toBe('turath');
    expect(turath.readTurathPage).toHaveBeenCalledWith('2166', 12);
    expect(r.page?.text).toBe('نص تراثي');
  });

  it('cloud-prefixed id but cloud disabled → falls back to local', async () => {
    const r = await mod.routeShamelaReadPage('55', 40, { localEnabled: true, cloudEnabled: false, preferTransport: 'cloud' });
    expect(r.transport).toBe('local');
  });

  it('local throws + cloud disabled + turath enabled → falls back to turath', async () => {
    native.readShamelaPage.mockRejectedValueOnce(new Error('file missing'));
    const r = await mod.routeShamelaReadPage('2166', 12, {
      localEnabled: true,
      cloudEnabled: false,
      turathEnabled: true,
      preferTransport: 'local',
    });
    expect(r.transport).toBe('turath');
    expect(r.page?.text).toBe('نص تراثي');
  });
});

describe('routeShamelaFindBook', () => {
  it('local with a masterDbPath → catalogue.searchBooks', async () => {
    const r = await mod.routeShamelaFindBook('بخاري', allThree);
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

  it('cloud THROWS → falls through to turath (bug fix verification)', async () => {
    native.detectShamelaInstallation.mockResolvedValueOnce({ installed: false, path: null, masterDbPath: null });
    mod._resetRouterCache();
    cloud.findCloudBook.mockRejectedValueOnce(new Error('cloud MCP offline'));

    const r = await mod.routeShamelaFindBook('المبسوط', allThree);
    expect(r.transport).toBe('turath');
    expect(turath.findTurathBook).toHaveBeenCalledWith('المبسوط');
    expect(r.books[0].id).toBe(2166);
    expect(r.books[0].title).toBe('المبسوط');
  });

  it('local off + cloud off + turath on → finds in turath', async () => {
    const r = await mod.routeShamelaFindBook('المبسوط', {
      localEnabled: false,
      cloudEnabled: false,
      turathEnabled: true,
    });
    expect(r.transport).toBe('turath');
    expect(turath.findTurathBook).toHaveBeenCalledWith('المبسوط');
    expect(r.books[0].id).toBe(2166);
  });

  it('all three off → transport none with connector enable message mentioning Turath', async () => {
    const r = await mod.routeShamelaFindBook('المبسوط', {
      localEnabled: false,
      cloudEnabled: false,
      turathEnabled: false,
    });
    expect(r.transport).toBe('none');
    expect(r.error).toMatch(/Turath/);
  });

  it('all three throw → transport none with combined error', async () => {
    native.detectShamelaInstallation.mockResolvedValueOnce({ installed: true, path: 'D:\\shamela4', masterDbPath: 'D:\\shamela4\\database\\master.db' });
    mod._resetRouterCache();
    catalogue.searchBooks.mockImplementationOnce(() => { throw new Error('local catalogue corrupt'); });
    cloud.findCloudBook.mockRejectedValueOnce(new Error('cloud offline'));
    turath.findTurathBook.mockRejectedValueOnce(new Error('turath timeout'));

    const r = await mod.routeShamelaFindBook('المبسوط', allThree);
    expect(r.transport).toBe('none');
    expect(r.error).toMatch(/local catalogue corrupt.*cloud offline.*turath timeout/);
  });
});
