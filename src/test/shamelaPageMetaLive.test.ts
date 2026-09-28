// @vitest-environment node
// M13 Phase 3 (ADR-0058) — LIVE: enrich real Shamela 4 hits from master.db +
// the book's page table. Runs only with SHAMELA_LIVE=1 on a machine with a
// local Shamela 4 install (the Lucene search needs Shamela's own JRE).
//
//     SHAMELA_LIVE=1 npx vitest run src/test/shamelaPageMetaLive.test.ts
import { describe, it, expect, vi } from 'vitest';
import os from 'node:os';

// Outside Electron: point the helper-jar lookup at the dev tree.
vi.mock('electron', () => ({
  app: { getAppPath: () => process.cwd(), isPackaged: false, getPath: () => os.tmpdir() },
}));

describe.runIf(process.env.SHAMELA_LIVE === '1')('Shamela page metadata (live)', () => {
  it('a real search hit gains title, author, volume and printed page', async () => {
    const { routeShamelaSearch } = await import('../../electron/agent/adapters/shamelaRouter');
    const r = await routeShamelaSearch('إنما الأعمال بالنيات', 5, { localEnabled: true, cloudEnabled: false, turathEnabled: false });
    // eslint-disable-next-line no-console
    console.log('live hits', JSON.stringify(r.hits.map((h) => ({ bookId: h.bookId, page: h.pageNumber, citation: h.citation, volume: h.volume, printed: h.printedPage })), null, 1));
    expect(r.transport).toBe('local');
    expect(r.hits.length).toBeGreaterThan(0);
    const enriched = r.hits.filter((h) => h.citation);
    expect(enriched.length).toBe(r.hits.length);
    for (const h of enriched) {
      expect(h.bookTitle).toBeTruthy();
      expect(h.citation).toContain(h.bookTitle!);
    }
    expect(enriched.some((h) => typeof h.printedPage === 'number')).toBe(true);
  }, 120_000);
});
