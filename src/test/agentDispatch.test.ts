// @vitest-environment node
// electron/agent/dispatch.ts — maps a tool call to the real adapter (SPEC-M8
// §3, security gates). All the real backends are mocked; this pins the parts
// that are dispatch's own logic: a search_* call feeds the retrieval ledger,
// insert_footnote REFUSES a source_id that wasn't retrieved (the integrity
// gate), every edit backs the chapter up first, and run_task fails loudly
// rather than pretending.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const wordMock = {
  readStructure: vi.fn(async () => ({ headings: ['A'], footnotes: [], trackedChanges: 0, wordCount: 9, readingOrder: 'rtl' })),
  applyCitations: vi.fn(async () => ({ outputPath: 'C:\\p\\01.docx', applied: 1, notFound: [], ms: 1 })),
  setChapterLayout: vi.fn(async () => ({ ms: 1 })),
  fromWord: vi.fn(async () => ({ outputPath: 'C:\\p\\export\\01.pdf', ms: 1 })),
  reflowPdf: vi.fn(async () => ({ outputPath: 'C:\\p\\export\\01.docx', wordCount: 5, ms: 1 })),
};
vi.mock('../../electron/adapters/word.ts', () => wordMock);

vi.mock('../../electron/host/index.ts', () => ({
  detectTools: vi.fn(() => ({ word: true, wordVersion: '16.0', windows: true })),
}));

const backupChapter = vi.fn(() => 'C:\\p\\.easyeditor\\backups\\ts__01.docx');
vi.mock('../../electron/fs/projectFolder.ts', () => ({
  chapterPath: (root: string, name: string) => `${root}\\${name}`,
  backupChapter,
}));

const searchChunks = vi.fn(async () => [
  { itemId: 'it1', title: 'Ihya Ulum al-Din', sourceRef: {}, pageNumber: 12, content: 'الحمد لله', rank: 1 },
]);
vi.mock('../../electron/ipc/workspaceHandlers.ts', () => ({
  getWorkspaceDbService: vi.fn(async () => ({ searchChunks })),
}));

vi.mock('../../electron/shamela/shamelaNative.ts', () => ({
  searchShamelaNative: vi.fn(async () => [
    { bookId: '55', bookTitle: 'صحيح البخاري', pageNumber: 40, snippet: 'إنما الأعمال', score: 0.9 },
  ]),
}));

let createDispatcher: typeof import('../../electron/agent/dispatch.ts').createDispatcher;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ createDispatcher } = await import('../../electron/agent/dispatch.ts'));
});

const mk = () => createDispatcher({ projectRoot: 'C:\\p' });

describe('agent dispatch', () => {
  it('list_capabilities returns the machine summary', async () => {
    const { dispatch } = mk();
    const r = await dispatch('list_capabilities', {}) as { word: boolean; summary: string };
    expect(r.word).toBe(true);
    expect(r.summary).toMatch(/Word/);
  });

  it('read_document goes through word.readStructure at the resolved chapter path', async () => {
    const { dispatch } = mk();
    await dispatch('read_document', { chapter: '02-body.docx' });
    expect(wordMock.readStructure).toHaveBeenCalledWith('C:\\p\\02-body.docx');
  });

  it('search_corpus fills the retrieval ledger and returns compact results', async () => {
    const { dispatch, ledger } = mk();
    const r = await dispatch('search_corpus', { query: 'برکت', limit: 3 }) as { count: number; results: Array<{ id: string }> };
    expect(searchChunks).toHaveBeenCalledWith('برکت', 3);
    expect(r.count).toBe(1);
    expect(ledger.size).toBe(1);
    // the id the model must echo back to insert_footnote
    expect(r.results[0].id).toBe('corpus:it1:12');
  });

  it('insert_footnote REFUSES a source_id that was never retrieved', async () => {
    const { dispatch } = mk();
    await expect(dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: 'corpus:fake:1' }))
      .rejects.toThrow(/not one of|nothing has been retrieved/);
    expect(wordMock.applyCitations).not.toHaveBeenCalled();
  });

  it('insert_footnote uses the retrieved reference, backs up, and tracks the change', async () => {
    const { dispatch } = mk();
    await dispatch('search_shamela', { query: 'الأعمال' });
    const r = await dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: 'shamela:55:40' }) as { reference: string; backedUp: boolean };
    expect(backupChapter).toHaveBeenCalledWith('C:\\p', '01.docx');
    expect(wordMock.applyCitations).toHaveBeenCalledWith(
      { sourcePath: 'C:\\p\\01.docx' },
      [{ marker: '[1]', text: expect.stringContaining('صحيح البخاري') }],
      'C:\\p\\01.docx',
      { trackChanges: true },
    );
    expect(r.reference).toContain('صحيح البخاري');
    expect(r.backedUp).toBe(true);
  });

  it('set_page_layout backs up then edits in place', async () => {
    const { dispatch } = mk();
    await dispatch('set_page_layout', { chapter: '01.docx' });
    expect(backupChapter).toHaveBeenCalled();
    expect(wordMock.setChapterLayout).toHaveBeenCalledWith('C:\\p\\01.docx');
  });

  it('run_task is not available in this build and says so', async () => {
    const { dispatch } = mk();
    const r = await dispatch('run_task', { chapter: '01.docx', task: 'harakat' }) as { error: string };
    expect(r.error).toMatch(/not available/i);
  });
});
