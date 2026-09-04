// @vitest-environment node
// electron/agent/dispatch.ts — maps a tool call to the real adapter (SPEC-M8
// §3, security gates). All the real backends are mocked; this pins the parts
// that are dispatch's own logic: a search_* call feeds the retrieval ledger,
// insert_footnote REFUSES a source_id that wasn't retrieved (the integrity
// gate), every edit backs the chapter up first, and run_task fails loudly
// rather than pretending.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import fs from 'node:fs';

const wordMock = {
  readStructure: vi.fn(async () => ({ headings: ['A'], footnotes: [], trackedChanges: 0, wordCount: 9, readingOrder: 'rtl' })),
  applyCitations: vi.fn(async () => ({ outputPath: 'C:\\p\\01.docx', applied: 1, notFound: [], ms: 1 })),
  setChapterLayout: vi.fn(async () => ({ ms: 1 })),
  fromWord: vi.fn(async (_src: string, _to: string, out: string) => { fs.writeFileSync(out, 'باب دو میں برکت کا ذکر ہے۔ برکت ایک اہم موضوع ہے۔'); return { outputPath: out, ms: 1 }; }),
  reflowPdf: vi.fn(async () => ({ outputPath: 'C:\\p\\export\\01.docx', wordCount: 5, ms: 1 })),
  installFont: vi.fn(async () => ({ fontName: 'Jameel Noori Nastaleeq', verified: true })),
  installTemplate: vi.fn(async () => ({ templateName: 'thesis', installedTo: 'C:\\t\\thesis.dotx', ms: 1 })),
  getWordOption: vi.fn(async () => 'true'),
  setWordOption: vi.fn(async () => 'false'),
  applyTextTask: vi.fn(async () => ({ revisions: 4, ms: 1 })),
  addComment: vi.fn(async (_p: string, o: { anchorText: string }) => ({ added: o.anchorText !== 'nope', notFound: o.anchorText === 'nope', ms: 1 })),
  createChapter: vi.fn(async (dest: string, _opts?: { html?: string; rtl?: boolean }) => ({ outputPath: dest, name: dest.split('\\').pop() ?? dest, ms: 1 })),
  ALLOWED_GLOBAL_OPTIONS: { check_spelling: 'CheckSpellingAsYouType', check_grammar: 'CheckGrammarAsYouType', smart_quotes: 'AutoFormatAsYouTypeReplaceQuotes' },
};
vi.mock('../../electron/adapters/word.ts', () => wordMock);

const generateContentStream = vi.fn(async () => 'باب دو میں برکت کا ذکر ہے — درست شدہ متن۔');
vi.mock('../../electron/ai/geminiClient.ts', () => ({ generateContentStream }));

const recordWrite = vi.fn();
const recordEdit = recordWrite; // M9: recordEdit is an alias of recordWrite
vi.mock('../../electron/agent/checkpoint.ts', () => ({ recordWrite, recordEdit: recordWrite }));

vi.mock('../../electron/host/index.ts', () => ({
  detectTools: vi.fn(() => ({ word: true, wordVersion: '16.0', windows: true })),
}));

const backupChapter = vi.fn(() => 'C:\\p\\.easyeditor\\backups\\ts__01.docx');
const readAssetText = vi.fn(() => 'پہلا پیراگراف\n\nدوسرا پیراگراف');
const writeAssetText = vi.fn((_r: string, name: string) => name);
const registerChapter = vi.fn(() => ({ bytes: 10 }));
vi.mock('../../electron/fs/projectFolder.ts', () => ({
  chapterPath: (root: string, name: string) => `${root}\\${name}`,
  backupChapter,
  readAssetText,
  writeAssetText,
  registerChapter,
  refreshChapters: () => [
    { name: '01.docx', format: 'docx', size: 1, modifiedAt: 'x', order: 0 },
    { name: '02-body.docx', format: 'docx', size: 1, modifiedAt: 'x', order: 1 },
  ],
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

const queryTafseer: ReturnType<typeof vi.fn> = vi.fn(async () => ({
  chunks: [{ id: 'tafsir:tafsir:tabari:البقرة: 255', reference: 'تفسير (tabari) — البقرة: 255 (tafsir.net)', content: 'الله لا إله إلا هو' }] as Array<{ id: string; reference: string; content: string }>,
  text: 'الله لا إله إلا هو الحي القيوم',
  note: undefined as string | undefined,
  error: undefined as string | undefined,
}));
vi.mock('../../electron/agent/adapters/tafsir.ts', () => ({ queryTafseer }));

let createDispatcher: typeof import('../../electron/agent/dispatch.ts').createDispatcher;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ createDispatcher } = await import('../../electron/agent/dispatch.ts'));
});

const mk = (over: Partial<Parameters<typeof createDispatcher>[0]> = {}) =>
  createDispatcher({ projectRoot: 'C:\\p', checkpointId: 'cp_1', ...over });

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

  it('search_corpus searches the imported corpus AND the open chapters, filling the ledger', async () => {
    const { dispatch, ledger } = mk();
    const r = await dispatch('search_corpus', { query: 'برکت', limit: 3 }) as { count: number; results: Array<{ id: string; reference: string }> };
    expect(searchChunks).toHaveBeenCalledWith('برکت', 3);
    // one FTS hit (corpus:it1:12) + the mock chapter text contains "برکت"
    expect(r.results.map((x) => x.id)).toContain('corpus:it1:12');
    expect(r.results.some((x) => x.id.startsWith('chapter:'))).toBe(true);
    expect(ledger.size).toBe(r.count);
  });

  it('search_corpus reports plainly when nothing matches', async () => {
    searchChunks.mockResolvedValueOnce([]);
    const { dispatch } = mk();
    const r = await dispatch('search_corpus', { query: 'zzznotfound' }) as { count: number; note?: string };
    expect(r.count).toBe(0);
    expect(r.note).toMatch(/Nothing matched/);
  });

  it('query_tafseer feeds the ledger with a citable book+surah+ayah chunk (M9 Phase 1)', async () => {
    const { dispatch, ledger } = mk();
    const r = await dispatch('query_tafseer', { reference: '2:255', mode: 'tafsir', sources: ['tabari'] }) as { count: number; results: Array<{ id: string }> };
    expect(queryTafseer).toHaveBeenCalledWith(expect.objectContaining({ reference: '2:255', mode: 'tafsir', sources: ['tabari'] }));
    expect(r.count).toBe(1);
    expect(ledger.size).toBe(1);
    // and it is now citable
    const foot = await dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: r.results[0].id }) as { reference: string };
    expect(foot.reference).toMatch(/tafsir\.net/);
  });

  it('query_tafseer surfaces an unavailable-sources error without throwing', async () => {
    queryTafseer.mockResolvedValueOnce({ chunks: [], text: '', error: 'The Tafsir sources are not reachable' });
    const { dispatch } = mk();
    const r = await dispatch('query_tafseer', { reference: '2:255', mode: 'ayah' }) as { error?: string };
    expect(r.error).toMatch(/not reachable/);
  });

  it('search_hadith maps islamic-search citations to citable ledger chunks (M9 Phase 1)', async () => {
    const researchSearch = vi.fn(async () => ({
      answer: 'حديث «إنما الأعمال بالنيات» متفق عليه.',
      citations: [
        { domain: 'hadith', citation_ref: { collection: 'صحيح البخاري', hadith_number: 1, grade: 'صحيح', rawi: 'عمر بن الخطاب' }, url: 'https://x/1' },
        { domain: 'hadith', citation_ref: {} }, // no ref → dropped
      ],
    }));
    const { dispatch, ledger } = mk({ researchSearch });
    const r = await dispatch('search_hadith', { query: 'إنما الأعمال' }) as { count: number; results: Array<{ id: string; reference: string }> };
    expect(researchSearch).toHaveBeenCalledWith('islamic', 'إنما الأعمال');
    expect(r.count).toBe(1);
    expect(r.results[0].reference).toMatch(/صحيح البخاري 1.*صحيح/);
    expect(ledger.size).toBe(1);
    const foot = await dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: r.results[0].id }) as { reference: string };
    expect(foot.reference).toMatch(/صحيح البخاري/);
  });

  it('search_hadith without a renderer bridge returns a clear message', async () => {
    const { dispatch } = mk({ researchSearch: null });
    const r = await dispatch('search_hadith', { query: 'x' }) as { error?: string };
    expect(r.error).toMatch(/Agent panel/);
  });

  it('transcribe_media saves the renderer-produced segments as an in-project transcript (M9 Phase 5)', async () => {
    const transcribeMedia = vi.fn(async () => ({ segments: [{ start: 0, end: 5, text: 'یہ درس کا پہلا حصہ ہے' }] }));
    const { dispatch } = mk({ transcribeMedia });
    const r = await dispatch('transcribe_media', { media_path: 'media/dars-01.mp3', lang: 'ur' }) as { transcriptPath: string; segments: number; note: string };
    expect(transcribeMedia).toHaveBeenCalledWith('media/dars-01.mp3', 'ur');
    expect(r.transcriptPath).toBe('sources/dars-01.transcript.txt');
    expect(r.segments).toBe(1);
    // the transcript is a project write, so it is part of the undo checkpoint
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', 'sources/dars-01.transcript.txt');
    // and the agent is told NOT to paste it back through a tool call
    expect(r.note).toMatch(/from_source/);
  });

  it('transcribe_media without the renderer bridge returns a clear message', async () => {
    const { dispatch } = mk({ transcribeMedia: null });
    const r = await dispatch('transcribe_media', { media_path: 'media/x.mp3' }) as { error?: string };
    expect(r.error).toMatch(/Agent panel/);
  });

  it('create_chapter seeds from a transcript file and checkpoints BEFORE the file exists', async () => {
    const { dispatch } = mk();
    const r = await dispatch('create_chapter', { name: '03-dars.docx', title: 'درسِ اول', from_source: 'sources/dars-01.transcript.txt' }) as { chapter: string; seededFrom: string; registered: boolean };
    // guardEdit ran with the NEW name so "Undo this task" deletes it
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '03-dars.docx');
    expect(readAssetText).toHaveBeenCalledWith('C:\\p', 'sources/dars-01.transcript.txt');
    const html = String((wordMock.createChapter.mock.calls[0][1] as { html: string }).html);
    expect(html).toContain('<h1>درسِ اول</h1>');
    expect(html).toContain('<p>پہلا پیراگراف</p>');
    expect(r.seededFrom).toBe('sources/dars-01.transcript.txt');
    expect(r.registered).toBe(true);
  });

  it('create_chapter reports a bad from_source instead of creating an empty chapter', async () => {
    readAssetText.mockImplementationOnce(() => { throw new Error('not a readable text asset'); });
    const { dispatch } = mk();
    const r = await dispatch('create_chapter', { name: '04.docx', from_source: 'media/x.mp3' }) as { error?: string };
    expect(r.error).toMatch(/could not read from_source/);
    expect(wordMock.createChapter).not.toHaveBeenCalled();
  });

  it('add_document_comment attaches a comment as a tracked change, checkpointed (M9 Phase 4)', async () => {
    const { dispatch } = mk();
    const r = await dispatch('add_document_comment', { chapter: '01.docx', anchor_text: 'قال المؤلف', comment: 'راجع النقل', author: 'المشرف' }) as { added: boolean; backedUp: boolean };
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '01.docx');
    expect(wordMock.addComment).toHaveBeenCalledWith('C:\\p\\01.docx', { anchorText: 'قال المؤلف', comment: 'راجع النقل', author: 'المشرف' });
    expect(r.added).toBe(true);
  });

  it('add_document_comment reports a missing anchor without failing', async () => {
    const { dispatch } = mk();
    const r = await dispatch('add_document_comment', { chapter: '01.docx', anchor_text: 'nope', comment: 'x' }) as { added: boolean; notFound: boolean; note?: string };
    expect(r.added).toBe(false);
    expect(r.notFound).toBe(true);
    expect(r.note).toMatch(/not found/);
  });

  it('insert_footnote REFUSES a source_id that was never retrieved', async () => {
    const { dispatch } = mk();
    await expect(dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: 'corpus:fake:1' }))
      .rejects.toThrow(/not one of|nothing has been retrieved/);
    expect(wordMock.applyCitations).not.toHaveBeenCalled();
  });

  it('insert_footnote uses the retrieved reference, checkpoints + backs up, and tracks the change', async () => {
    const { dispatch } = mk();
    await dispatch('search_shamela', { query: 'الأعمال' });
    const r = await dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: 'shamela:55:40' }) as { reference: string; backedUp: boolean };
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '01.docx');
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

  it('insert_footnote REFUSES when the claim-check says the source does not support the claim', async () => {
    const claimCheck = vi.fn(async () => ({ supports: false, note: 'excerpt is about wudu, not the claim' }));
    const { dispatch } = mk({ claimCheck });
    await dispatch('search_shamela', { query: 'x' });
    await expect(dispatch('insert_footnote', {
      chapter: '01.docx', marker: '[1]', source_id: 'shamela:55:40', claim: 'The Prophet forbade X.',
    })).rejects.toThrow(/does not support this claim/);
    expect(wordMock.applyCitations).not.toHaveBeenCalled();
  });

  it('set_page_layout checkpoints + backs up then edits in place', async () => {
    const { dispatch } = mk();
    await dispatch('set_page_layout', { chapter: '01.docx' });
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '01.docx');
    expect(backupChapter).toHaveBeenCalled();
    expect(wordMock.setChapterLayout).toHaveBeenCalledWith('C:\\p\\01.docx');
  });

  it('check_consistency finds the term in the OTHER chapters and suggests a review', async () => {
    const { dispatch } = mk();
    const r = await dispatch('check_consistency', { term: 'برکت', exclude_chapter: '01.docx' }) as { appearsIn: Array<{ chapter: string; count: number }>; suggestion: string };
    expect(r.appearsIn.map((x) => x.chapter)).toEqual(['02-body.docx']);
    expect(r.appearsIn[0].count).toBe(2);
    expect(r.suggestion).toMatch(/consider reviewing/);
  });

  it('run_task refines the chapter in place as a tracked change', async () => {
    const { dispatch } = mk();
    const r = await dispatch('run_task', { chapter: '01.docx', task: 'harakat' }) as { task: string; revisions: number; backedUp: boolean; changed: boolean };
    expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({ systemInstruction: expect.stringMatching(/diacritics|harakat/i) }));
    expect(wordMock.applyTextTask).toHaveBeenCalledWith('C:\\p\\01.docx', expect.stringContaining('درست'), { isHtml: false });
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '01.docx');
    expect(r).toMatchObject({ task: 'add_harakat', revisions: 4, backedUp: true, changed: true });
  });

  it('run_task maps auto-format to an HTML task and rejects an unknown slug / citations', async () => {
    const { dispatch } = mk();
    await dispatch('run_task', { chapter: '01.docx', task: 'auto-format' });
    expect(wordMock.applyTextTask).toHaveBeenCalledWith('C:\\p\\01.docx', expect.any(String), { isHtml: true });
    expect(await dispatch('run_task', { chapter: '01.docx', task: 'make-it-nice' })).toMatchObject({ error: expect.stringMatching(/unknown task/) });
    expect(await dispatch('run_task', { chapter: '01.docx', task: 'citations' })).toMatchObject({ error: expect.stringMatching(/insert_footnote/) });
  });
});

describe('search_general (renderer-bridged, ADR-0019 #7)', () => {
  it('returns a clear message when no bridge is available (headless)', async () => {
    const { dispatch } = mk();
    const r = await dispatch('search_general', { query: 'who was al-Ghazali' }) as { error: string };
    expect(r.error).toMatch(/Agent panel|signed-in/i);
  });

  it('routes through the injected bridge and tags the channel — but never enters the citation ledger', async () => {
    const generalSearch = vi.fn(async () => ({ answer: 'Al-Ghazali (d. 505 AH) was a theologian and jurist.', channel: 'general' }));
    const { dispatch, ledger } = mk({ generalSearch });
    const r = await dispatch('search_general', { query: 'al-Ghazali' }) as { channel: string; answer: string };
    expect(generalSearch).toHaveBeenCalledWith('al-Ghazali');
    expect(r).toMatchObject({ channel: 'general', answer: expect.stringContaining('theologian') });
    expect(ledger.size).toBe(0);
    // insert_footnote cannot cite it — it was never retrieved
    await expect(dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: 'general:1' }))
      .rejects.toThrow(/nothing has been retrieved|not one of/);
  });

  it('surfaces the bridge error (offline / not signed in)', async () => {
    const generalSearch = vi.fn(async () => ({ error: 'General search needs an internet connection and a signed-in session.' }));
    const { dispatch } = mk({ generalSearch });
    const r = await dispatch('search_general', { query: 'x' }) as { error: string };
    expect(r.error).toMatch(/internet connection/);
  });
});

describe('P9 tools — font / template / global options', () => {
  it('install_font rejects a URL and a relative path, but installs an absolute font file', async () => {
    const { dispatch } = mk();
    expect(await dispatch('install_font', { font_path: 'https://example.com/x.ttf' })).toMatchObject({ error: expect.stringMatching(/URL/i) });
    expect(await dispatch('install_font', { font_path: 'fonts/x.ttf' })).toMatchObject({ error: expect.stringMatching(/absolute/i) });
    expect(wordMock.installFont).not.toHaveBeenCalled();
    await dispatch('install_font', { font_path: 'C:\\fonts\\Jameel.ttf' });
    expect(wordMock.installFont).toHaveBeenCalledWith('C:\\fonts\\Jameel.ttf');
  });

  it('install_template checkpoints + backs up the chapter it attaches to', async () => {
    const { dispatch } = mk();
    await dispatch('install_template', { template_path: 'C:\\t\\thesis.dotx', chapter: '01.docx' });
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '01.docx');
    expect(backupChapter).toHaveBeenCalledWith('C:\\p', '01.docx');
    expect(wordMock.installTemplate).toHaveBeenCalledWith('C:\\t\\thesis.dotx', { chapterPath: 'C:\\p\\01.docx' });
  });

  it('set_global_option returns a consent request and applies NOTHING', async () => {
    const { dispatch } = mk();
    const r = await dispatch('set_global_option', { option: 'check_spelling', value: 'false' }) as { needsConsent: boolean; current: string; message: string };
    expect(r.needsConsent).toBe(true);
    expect(r.current).toBe('true');
    expect(r.message).toMatch(/approve/i);
    expect(wordMock.setWordOption).not.toHaveBeenCalled();
  });

  it('set_global_option refuses an option outside the allow-list', async () => {
    const { dispatch } = mk();
    const r = await dispatch('set_global_option', { option: 'DisableAllMacros', value: 'true' }) as { error: string };
    expect(r.error).toMatch(/only allows/i);
  });

  it('set_global_option is a no-op when Word is already at that value', async () => {
    wordMock.getWordOption.mockResolvedValueOnce('false');
    const { dispatch } = mk();
    const r = await dispatch('set_global_option', { option: 'check_spelling', value: 'false' }) as { needsConsent: boolean; note: string };
    expect(r.needsConsent).toBe(false);
    expect(r.note).toMatch(/already/i);
  });
});
