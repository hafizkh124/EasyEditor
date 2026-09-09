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
  compareManuscripts: vi.fn(async () => ({
    revisions: [
      { type: 'delete', text: 'نورٌ', context: '… العلم نورٌ يهدي …', page: 3 },
      { type: 'insert', text: 'ضياءٌ', context: '… العلم ضياءٌ يهدي …', page: 3 },
      { type: 'insert', text: 'رحمه الله', context: '', page: 5 },
    ],
    count: 3, ms: 1,
  })),
  buildIndexes: vi.fn(async () => ({ marked: 5, ms: 1 })),
  setPrintLayout: vi.fn(async () => ({ pageWidth: 481.89, pageHeight: 680.32, gutter: 34.02, ms: 1 })),
  ALLOWED_GLOBAL_OPTIONS: { check_spelling: 'CheckSpellingAsYouType', check_grammar: 'CheckGrammarAsYouType', smart_quotes: 'AutoFormatAsYouTypeReplaceQuotes' },
};
vi.mock('../../electron/adapters/word.ts', () => wordMock);

const generateContentStream = vi.fn(async () => 'باب دو میں برکت کا ذکر ہے — درست شدہ متن۔');
vi.mock('../../electron/ai/geminiClient.ts', () => ({ generateContentStream }));

const runCritique = vi.fn(async () => ({ ok: true, text: 'الحكم: سليم مع إصلاحات.\n1. الفقرة الثانية بلا مصدر.', model: 'gemini:gemini-2.5-flash' }));
vi.mock('../../electron/agent/critic.ts', () => ({ runCritique }));

const readDisclosureEntries = vi.fn((): unknown[] => []);
vi.mock('../../electron/agent/disclosure.ts', () => ({ readDisclosureEntries }));

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

// ADR-0044 — mock the router so dispatch tests control the transport + keep the
// MCP-SDK-heavy cloud client out of this suite.
const shamelaRouterMock = {
  routeShamelaSearch: vi.fn(async (): Promise<import('../../electron/agent/adapters/shamelaRouter').SearchRoute> => ({
    hits: [{ bookId: '55', bookTitle: 'صحيح البخاري', pageNumber: 40, snippet: 'إنما الأعمال', score: 0.9 }],
    transport: 'local',
  })),
  routeShamelaReadPage: vi.fn(async (): Promise<import('../../electron/agent/adapters/shamelaRouter').PageRoute> => ({
    page: { bookId: '55', pageNumber: 40, text: 'نص الصفحة كاملًا', footnotes: undefined },
    transport: 'local',
  })),
  routeShamelaFindBook: vi.fn(async (): Promise<import('../../electron/agent/adapters/shamelaRouter').BookRoute> => ({
    books: [{ id: 55, title: 'صحيح البخاري', author: 'البخاري', deathYear: 256 }],
    transport: 'local',
  })),
};
vi.mock('../../electron/agent/adapters/shamelaRouter.ts', () => shamelaRouterMock);

const queryTafseer: ReturnType<typeof vi.fn> = vi.fn(async () => ({
  chunks: [{ id: 'tafsir:tafsir:tabari:البقرة: 255', reference: 'تفسير (tabari) — البقرة: 255 (tafsir.net)', content: 'الله لا إله إلا هو' }] as Array<{ id: string; reference: string; content: string }>,
  text: 'الله لا إله إلا هو الحي القيوم',
  note: undefined as string | undefined,
  error: undefined as string | undefined,
}));
vi.mock('../../electron/agent/adapters/tafsir.ts', () => ({ queryTafseer }));

// ADR-0040 (amended) — the direct dorar.net fetch is the fallback path for
// grade_hadith; mock it so tests never hit the network.
const gradeHadith: ReturnType<typeof vi.fn> = vi.fn(async () => ({
  chunks: [] as Array<{ id: string; reference: string; content?: string; grade?: string }>,
  note: undefined as string | undefined,
  error: undefined as string | undefined,
}));
vi.mock('../../electron/agent/adapters/dorar.ts', () => ({ gradeHadith }));

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

  it('search_repositories feeds the ledger with bibliographic chunks; insert_footnote refuses one + a claim (M9 Phase 9)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ response: { docs: [{ identifier: 'A1', title: 'Ihya', creator: 'Ghazali', year: 1990 }] } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ results: [{ title: 'Maqasid', publication_year: 2008, doi: 'https://doi.org/10/x' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { dispatch } = mk();
      const r = await dispatch('search_repositories', { query: 'ihya', repo: 'all' }) as { count: number; results: Array<{ id: string; bibliographic: boolean }> };
      expect(r.count).toBe(2);
      expect(r.results.every((x) => x.bibliographic)).toBe(true);

      // cite a work with NO claim → allowed (word.applyCitations runs)
      await dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: r.results[0].id });
      // cite it WITH a claim → refused
      await expect(dispatch('insert_footnote', { chapter: '01.docx', marker: '[2]', source_id: r.results[1].id, claim: 'The book says X.' }))
        .rejects.toThrow(/bibliographic reference to a work you have not read/);
    } finally {
      vi.unstubAllGlobals();
    }
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

  // ── ADR-0040 (amended): grade_hadith is bridge-first ─────────────────────
  it('grade_hadith takes الدرر السنية rows from the research bridge (dorar.net is IP-blocked)', async () => {
    const researchSearch = vi.fn(async () => ({
      answer: '…',
      citations: [
        { domain: 'dorar', citation_ref: { book: 'التمهيد', hadith_number: '21/270', grade: 'خطأ في إسناده', rawi: 'أبو سعيد', mohdith: 'ابن عبدالبر' }, url: 'https://dorar/1' },
        { domain: 'hadith', citation_ref: { collection: 'البخاري', hadith_number: 1, grade: 'صحيح' } }, // not dorar → ignored
      ],
    }));
    const { dispatch, ledger } = mk({ researchSearch });
    const r = await dispatch('grade_hadith', { text: 'إنما الأعمال بالنيات' }) as { count: number; results: Array<{ id: string; grade?: string; reference: string }> };
    expect(researchSearch).toHaveBeenCalledWith('islamic', 'إنما الأعمال بالنيات');
    expect(gradeHadith).not.toHaveBeenCalled();          // bridge answered → no direct fetch
    expect(r.count).toBe(1);
    expect(r.results[0].id).toMatch(/^dorar:/);
    expect(r.results[0].grade).toBe('خطأ في إسناده');
    expect(r.results[0].reference).toMatch(/الدرر السنية/);
    expect(ledger.size).toBe(1);
  });

  it('grade_hadith falls back to the direct adapter when the bridge has no dorar rows', async () => {
    const researchSearch = vi.fn(async () => ({ answer: '…', citations: [{ domain: 'hadith', citation_ref: { collection: 'البخاري', hadith_number: 1 } }] }));
    gradeHadith.mockResolvedValueOnce({ chunks: [{ id: 'dorar:abc123', reference: 'صحيح البخاري ١ — الحكم: صحيح (الدرر السنية)', content: 'متن', grade: 'صحيح' }], note: undefined, error: undefined });
    const { dispatch } = mk({ researchSearch });
    const r = await dispatch('grade_hadith', { text: 'نية' }) as { count: number; results: Array<{ grade?: string }> };
    expect(gradeHadith).toHaveBeenCalled();
    expect(r.count).toBe(1);
    expect(r.results[0].grade).toBe('صحيح');
  });

  it('grade_hadith with no bridge uses the direct adapter and surfaces its error', async () => {
    gradeHadith.mockResolvedValueOnce({ chunks: [], error: 'الدرر السنية returned HTTP 403' });
    const { dispatch } = mk({ researchSearch: null });
    const r = await dispatch('grade_hadith', { text: 'نية' }) as { error?: string };
    expect(r.error).toMatch(/403/);
  });

  it('lookup_narrator builds a rijāl-shaped query and maps citations to citable chunks (ADR-0041)', async () => {
    const researchSearch = vi.fn(async () => ({
      answer: 'شعبة بن الحجاج ثقة حافظ متقن.',
      citations: [
        { domain: 'classical-rijal', citation_ref: { book: 'تهذيب الكمال', page: 479, volume: 12 }, url: 'https://x/rijal' },
      ],
    }));
    const { dispatch, ledger } = mk({ researchSearch });
    const r = await dispatch('lookup_narrator', { name: 'شعبة بن الحجاج', aspect: 'grade' }) as { count: number; results: Array<{ id: string }> };
    const [mode, q] = researchSearch.mock.calls[0] as unknown as [string, string];
    expect(mode).toBe('islamic');
    expect(q).toContain('شعبة بن الحجاج');
    expect(q).toMatch(/رجال|الجرح والتعديل/);
    expect(r.count).toBe(1);
    expect(ledger.size).toBe(1);
    expect(r.results[0].id).toMatch(/^classical-rijal:rijal:/);
  });

  it('lookup_narrator without a renderer bridge returns a clear message', async () => {
    const { dispatch } = mk({ researchSearch: null });
    const r = await dispatch('lookup_narrator', { name: 'الأعمش' }) as { error?: string };
    expect(r.error).toMatch(/Agent panel/);
  });

  it('lookup_lexicon returns corpus chunks + an al-Maany link, and never a fabricated page citation (ADR-0043)', async () => {
    const researchSearch = vi.fn(async () => ({
      answer: 'سرابيل: قمیصیں۔',
      citations: [{ domain: 'islamicurdubooks-lexicon', citation_ref: { book: 'لغتِ قرآن', page: 7 }, url: 'https://x/lex' }],
    }));
    const { dispatch, ledger } = mk({ researchSearch });
    const r = await dispatch('lookup_lexicon', { word: 'سرابيل' }) as {
      count: number; almaanyUrl: string; results: Array<{ id: string }>;
    };
    expect((researchSearch.mock.calls[0] as unknown as [string])?.[0]).toBe('islamic');
    expect(r.almaanyUrl).toContain('almaany.com/ur/dict/ar-ur/');
    expect(r.count).toBe(1);
    // the corpus entry is in the ledger; the al-Maany link is NOT (cannot be footnoted)
    expect(ledger.size).toBe(1);
    expect(r.results.every((x) => !x.id.startsWith('lexicon:page:'))).toBe(true); // no bundled index → no page cite
  });

  it('lookup_lexicon with no corpus hit still gives the al-Maany link, no error', async () => {
    const researchSearch = vi.fn(async () => ({ answer: '', citations: [] }));
    const { dispatch } = mk({ researchSearch });
    const r = await dispatch('lookup_lexicon', { word: 'جهبذ' }) as { count: number; note: string; error?: string };
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(0);
    expect(r.note).toMatch(/almaany\.com/);
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

  it('ocr_document returns a consent request and uploads NOTHING when consent is absent (M9 Phase 7)', async () => {
    const ocrDocument = vi.fn(async () => ({ pages: [{ page: 1, text: 'متن' }] }));
    const { dispatch } = mk({ ocrDocument, ocrConsent: false });
    const r = await dispatch('ocr_document', { scan_path: 'sources/kitab-scan.pdf' }) as { needsConsent?: boolean; message?: string };
    expect(r.needsConsent).toBe(true);
    expect(r.message).toMatch(/cloud OCR/i);
    expect(ocrDocument).not.toHaveBeenCalled();
    expect(recordWrite).not.toHaveBeenCalled();
  });

  it('ocr_document with consent bridges to the renderer and saves a page-delimited .ocr.txt', async () => {
    const ocrDocument = vi.fn(async () => ({ pages: [{ page: 1, text: 'صفحہ اول' }, { page: 2, text: 'صفحہ دوم' }] }));
    const { dispatch } = mk({ ocrDocument, ocrConsent: true });
    const r = await dispatch('ocr_document', { scan_path: 'sources/kitab-scan.pdf', lang: 'ur', pages: '1-2' }) as { ocrPath: string; pageCount: number; note: string };
    expect(ocrDocument).toHaveBeenCalledWith('sources/kitab-scan.pdf', 'ur', '1-2');
    expect(r.ocrPath).toBe('sources/kitab-scan.ocr.txt');
    expect(r.pageCount).toBe(2);
    // the .ocr.txt is a project write, so it joins the undo checkpoint
    expect(recordWrite).toHaveBeenCalledWith('C:\\p', 'cp_1', 'sources/kitab-scan.ocr.txt');
    // the agent is told to label the chapter unverified and not to cite it
    expect(r.note).toMatch(/unverified|proofread/i);
  });

  it('ocr_document with consent but no renderer bridge returns a clear message', async () => {
    const { dispatch } = mk({ ocrConsent: true, ocrDocument: null });
    const r = await dispatch('ocr_document', { scan_path: 'sources/x.pdf' }) as { error?: string };
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

  it('typeset_print_ready applies a named trim + gutter, states the loss list, checkpointed (M9 Phase 8)', async () => {
    const { dispatch } = mk();
    const r = await dispatch('typeset_print_ready', { chapter: '01.docx', trim: 'waziri', header_odd: 'الباب الأول', header_even: 'كتاب التحقيق' }) as {
      trim: string; pageSizeCm: { width: number; gutter: number }; loss: string[]; note: string; backedUp: boolean;
    };
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '01.docx');
    expect(wordMock.setPrintLayout).toHaveBeenCalledWith('C:\\p\\01.docx', expect.objectContaining({
      trimWidthCm: 17, trimHeightCm: 24, gutterCm: 1.2, mirrorMargins: true, oddEvenHeaders: true, differentFirstPage: true, headerOdd: 'الباب الأول', headerEven: 'كتاب التحقيق',
    }));
    expect(r.trim).toMatch(/وزيري/);
    expect(r.loss.join(' ')).toMatch(/not press typesetting/i);
    expect(r.note).toMatch(/convert_document/);
  });

  it('typeset_print_ready rejects an unknown trim and an incomplete custom one', async () => {
    const { dispatch } = mk();
    expect(await dispatch('typeset_print_ready', { chapter: '01.docx', trim: 'tabloid' }) as { error?: string }).toMatchObject({ error: expect.stringMatching(/unknown trim/) });
    expect(await dispatch('typeset_print_ready', { chapter: '01.docx', trim: 'custom', trim_width_cm: 12 }) as { error?: string }).toMatchObject({ error: expect.stringMatching(/custom/) });
    expect(wordMock.setPrintLayout).not.toHaveBeenCalled();
  });

  it('compare_manuscript_variants collates two chapters into an apparatus, changing neither (M9 Phase 6)', async () => {
    const { dispatch } = mk();
    const r = await dispatch('compare_manuscript_variants', { base_chapter: '01.docx', witness_chapter: '02-body.docx', siglum: 'ح' }) as {
      count: number; loci: Array<{ kind: string; base: string; witness: string }>; note: string;
    };
    expect(wordMock.compareManuscripts).toHaveBeenCalledWith('C:\\p\\01.docx', 'C:\\p\\02-body.docx');
    // delete+insert → one substitution; lone insert → one addition
    expect(r.count).toBe(2);
    expect(r.loci[0]).toMatchObject({ kind: 'substitution', base: 'نورٌ', witness: 'ضياءٌ' });
    expect(r.loci[1]).toMatchObject({ kind: 'addition', witness: 'رحمه الله' });
    // read-effect: no checkpoint entry
    expect(recordEdit).not.toHaveBeenCalled();
    expect(r.note).toMatch(/insert_footnote|add_document_comment/);
  });

  it('compare_manuscript_variants reports identical witnesses', async () => {
    wordMock.compareManuscripts.mockResolvedValueOnce({ revisions: [], count: 0, ms: 1 });
    const { dispatch } = mk();
    const r = await dispatch('compare_manuscript_variants', { base_chapter: '01.docx', witness_chapter: '02-body.docx' }) as { count: number; note: string };
    expect(r.count).toBe(0);
    expect(r.note).toMatch(/identical/);
  });

  it('build_scholarly_indexes extracts entries, marks them, appends the INDEX, checkpointed (M9 Phase 6)', async () => {
    generateContentStream.mockResolvedValueOnce('[{"find":"قال الغزالي","entry":"الغزالي، أبو حامد"}]');
    const { dispatch } = mk();
    const r = await dispatch('build_scholarly_indexes', { chapter: '01.docx', kinds: ['names'], heading: 'فہرس الأعلام' }) as { entryCount: number; marked: number; backedUp: boolean };
    expect(recordEdit).toHaveBeenCalledWith('C:\\p', 'cp_1', '01.docx');
    expect(wordMock.buildIndexes).toHaveBeenCalledWith('C:\\p\\01.docx', [{ find: 'قال الغزالي', entry: 'الغزالي، أبو حامد' }], { heading: 'فہرس الأعلام' });
    expect(r.entryCount).toBe(1);
    expect(r.marked).toBe(5);
  });

  it('build_scholarly_indexes rejects an unknown kind and skips extraction when nothing is found', async () => {
    const { dispatch } = mk();
    expect(await dispatch('build_scholarly_indexes', { chapter: '01.docx', kinds: ['nonsense'] }) as { error?: string }).toMatchObject({ error: expect.stringMatching(/at least one of/) });
    generateContentStream.mockResolvedValueOnce('[]');
    const r = await dispatch('build_scholarly_indexes', { chapter: '01.docx', kinds: ['places'] }) as { count: number; note: string };
    expect(r.count).toBe(0);
    expect(wordMock.buildIndexes).not.toHaveBeenCalled();
  });

  it('build_scholarly_indexes accepts pre-built "find||entry" pairs and skips the model', async () => {
    const { dispatch } = mk();
    await dispatch('build_scholarly_indexes', { chapter: '01.docx', kinds: ['names'], entries: ['ابن تيمية||ابن تيمية، تقي الدين', 'bad-no-separator'] });
    expect(generateContentStream).not.toHaveBeenCalled();
    expect(wordMock.buildIndexes).toHaveBeenCalledWith('C:\\p\\01.docx', [{ find: 'ابن تيمية', entry: 'ابن تيمية، تقي الدين' }], {});
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

  it('insert_footnote emits a citation artifact carrying the source passage (open-before-accept)', async () => {
    const events: Array<Record<string, unknown>> = [];
    const { dispatch } = mk({ emitArtifact: (ev) => events.push(ev as Record<string, unknown>) });
    await dispatch('search_shamela', { query: 'الأعمال' });
    await dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: 'shamela:55:40', claim: 'x' });
    const cites = events.find((e) => e.op === 'citations') as { entries: Array<Record<string, unknown>> } | undefined;
    expect(cites?.entries[0]).toMatchObject({
      marker: '[1]', sourceId: 'shamela:55:40', tier: 1, excerpt: 'إنما الأعمال', claim: 'x',
    });
    expect((events.find((e) => e.op === 'close') as { targetChapter?: string } | undefined)?.targetChapter).toBe('01.docx');
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

  // ── ADR-0044: dual Shamela via the router ────────────────────────────────
  it('search_shamela: local transport → shamela:… ids, carries transport', async () => {
    const { dispatch, ledger } = mk();
    const r = await dispatch('search_shamela', { query: 'نية' }) as { count: number; transport: string; results: Array<{ id: string }> };
    expect(shamelaRouterMock.routeShamelaSearch).toHaveBeenCalled();
    expect(r.transport).toBe('local');
    expect(r.results[0].id).toMatch(/^shamela:/);
    expect(ledger.size).toBe(1);
  });

  it('search_shamela: cloud transport → shamela-cloud:… ids; a text-only hit is bibliographic', async () => {
    shamelaRouterMock.routeShamelaSearch.mockResolvedValueOnce({
      hits: [{ bookId: 'h0abc', bookTitle: 'شامله لنک', pageNumber: 0, snippet: 'نص', score: 0 }],
      transport: 'cloud',
    });
    const { dispatch } = mk();
    const r = await dispatch('search_shamela', { query: 'نية' }) as { transport: string; results: Array<{ id: string }> };
    expect(r.transport).toBe('cloud');
    expect(r.results[0].id).toMatch(/^shamela-cloud:/);
  });

  it('search_shamela: router transport "none" + error → { error }', async () => {
    shamelaRouterMock.routeShamelaSearch.mockResolvedValueOnce({ hits: [], transport: 'none', error: 'both off' });
    const { dispatch } = mk();
    const r = await dispatch('search_shamela', { query: 'x' }) as { error?: string };
    expect(r.error).toBe('both off');
  });

  it('read_shamela_page: parses the id, routes by prefix, ledgers the page', async () => {
    const { dispatch, ledger } = mk();
    const r = await dispatch('read_shamela_page', { source_id: 'shamela-cloud:55:40' }) as { text: string; transport: string };
    expect(shamelaRouterMock.routeShamelaReadPage).toHaveBeenCalledWith('55', 40, expect.objectContaining({ preferTransport: 'cloud' }));
    expect(r.text).toContain('نص الصفحة');
    expect(ledger.size).toBe(1);
  });

  it('read_shamela_page: a bad id is a clear error', async () => {
    const { dispatch } = mk();
    const r = await dispatch('read_shamela_page', { source_id: 'not-an-id' }) as { error?: string };
    expect(r.error).toMatch(/shamela:<bookId>/);
  });

  it('find_shamela_book: returns books (not a ledger tool)', async () => {
    const { dispatch, ledger } = mk();
    const r = await dispatch('find_shamela_book', { query: 'بخاري' }) as { books: Array<{ id: number }>; transport: string };
    expect(r.books[0].id).toBe(55);
    expect(r.transport).toBe('local');
    expect(ledger.size).toBe(0);
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

describe('author voice (طرز_تحریر.md — M9 Phase A)', () => {
  const VOICE = 'میرا اسلوب: مختصر، باوقار جملے۔ اصطلاح "فریضہ"۔';

  it('run_task shapes a rewriting task with the voice, but leaves a mechanical pass untouched', async () => {
    const { dispatch } = mk({ authorVoice: VOICE });

    await dispatch('run_task', { chapter: '01.docx', task: 'formalize' });
    expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({
      systemInstruction: expect.stringContaining("AUTHOR'S VOICE"),
    }));
    expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({
      systemInstruction: expect.stringContaining(VOICE),
    }));

    generateContentStream.mockClear();
    await dispatch('run_task', { chapter: '01.docx', task: 'harakat' });
    expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({
      systemInstruction: expect.not.stringContaining("AUTHOR'S VOICE"),
    }));
  });

  it('run_task without a voice file passes the bare template', async () => {
    const { dispatch } = mk();
    await dispatch('run_task', { chapter: '01.docx', task: 'formalize' });
    expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({
      systemInstruction: expect.not.stringContaining("AUTHOR'S VOICE"),
    }));
  });

  it('draft_section appends the voice to the mode template and reports voiceApplied', async () => {
    const { dispatch } = mk({ authorVoice: VOICE });
    const r = await dispatch('draft_section', { chapter: '01.docx', mode: 'literary-urdu' }) as { voiceApplied: boolean; note?: string };
    expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({
      systemInstruction: expect.stringContaining(VOICE),
    }));
    expect(r.voiceApplied).toBe(true);
    expect(r.note).toBeUndefined();
  });

  it('draft_section without a voice file nudges the scholar to add one', async () => {
    const { dispatch } = mk();
    const r = await dispatch('draft_section', { chapter: '01.docx', mode: 'literary-urdu' }) as { voiceApplied: boolean; note?: string };
    expect(r.voiceApplied).toBe(false);
    expect(r.note).toMatch(/طرز_تحریر\.md/);
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

describe('extract_author_voice (M9 Phase A)', () => {
  it('reads the project chapters, drafts a طرز_تحریر.md, and never overwrites an existing one', async () => {
    generateContentStream.mockResolvedValueOnce('- Register: measured, first-person effaced.\n- Connectives: "چنانچہ", "بنا بریں".');
    const { dispatch } = mk();
    const r = await dispatch('extract_author_voice', {}) as { file: string; chaptersAnalysed: number; preview: string; note: string };

    expect(generateContentStream).toHaveBeenCalledWith(expect.objectContaining({
      systemInstruction: expect.stringMatching(/writing voice|register|connectives/i),
    }));
    expect(r.file).toBe('طرز_تحریر.md'); // no existing file in the fake project
    expect(r.chaptersAnalysed).toBeGreaterThan(0);
    expect(r.preview).toContain('چنانچہ');
    expect(writeAssetText).toHaveBeenCalledWith('C:\\p', 'طرز_تحریر.md', expect.stringContaining('مسودہ'));
    expect(r.note).toMatch(/DRAFT/);
  });

  it('learns from only the named chapters when given some', async () => {
    const { dispatch } = mk();
    await dispatch('extract_author_voice', { chapters: ['02-body.docx'] });
    // the prompt block names the chapter it sampled
    expect(generateContentStream).toHaveBeenLastCalledWith(expect.objectContaining({ prompt: expect.stringContaining('02-body.docx') }));
  });

  it('errors when the folder has no readable chapter text', async () => {
    wordMock.fromWord.mockImplementation(async (_s: string, _t: string, out: string) => { fs.writeFileSync(out, '  '); return { outputPath: out, ms: 1 }; });
    const { dispatch } = mk();
    expect(await dispatch('extract_author_voice', {})).toMatchObject({ error: expect.stringMatching(/no readable text/) });
    wordMock.fromWord.mockImplementation(async (_s: string, _t: string, out: string) => { fs.writeFileSync(out, 'باب دو میں برکت کا ذکر ہے۔'); return { outputPath: out, ms: 1 }; });
  });
});

describe('critique (reasoning-model critic — M9 Phase C/E)', () => {
  it('reads the chapter, runs the critic, and returns an advisory result', async () => {
    const { dispatch } = mk();
    const r = await dispatch('critique', { chapter: '01.docx', kind: 'sourcing', focus: 'the isnad' }) as {
      ok: boolean; critique: string; critic: string; note: string;
    };
    expect(runCritique).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sourcing', focus: 'the isnad', subject: expect.stringContaining('برکت') }));
    expect(r.ok).toBe(true);
    expect(r.critique).toContain('الحكم');
    expect(r.note).toMatch(/advisory only/i);
  });

  it('an unknown kind falls back to "draft"', async () => {
    const { dispatch } = mk();
    await dispatch('critique', { chapter: '01.docx', kind: 'nonsense' });
    expect(runCritique).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'draft' }));
  });

  it('errors on a chapter with no text', async () => {
    wordMock.fromWord.mockImplementationOnce(async (_s: string, _t: string, out: string) => { fs.writeFileSync(out, '   '); return { outputPath: out, ms: 1 }; });
    const { dispatch } = mk();
    expect(await dispatch('critique', { chapter: '09-blank.docx' })).toMatchObject({ error: expect.stringMatching(/no text to critique/) });
  });

  it('surfaces the note when the critic could not run', async () => {
    runCritique.mockResolvedValueOnce({ ok: false, text: '(critic unavailable — no key)', model: undefined as unknown as string });
    const { dispatch } = mk();
    const r = await dispatch('critique', { chapter: '01.docx' }) as { ok: boolean; note: string };
    expect(r.ok).toBe(false);
    expect(r.note).toMatch(/could not run/);
  });
});

describe('compile_ai_disclosure (blueprint §3, optional)', () => {
  it('says nothing is needed when the ledger is empty', async () => {
    readDisclosureEntries.mockReturnValueOnce([]);
    const { dispatch } = mk();
    expect(await dispatch('compile_ai_disclosure', {})).toMatchObject({ count: 0, note: expect.stringMatching(/no disclosure statement is needed/i) });
    expect(writeAssetText).not.toHaveBeenCalled();
  });

  it('writes AI-DISCLOSURE.md from the ledger and emits it as an artifact', async () => {
    readDisclosureEntries.mockReturnValueOnce([
      { ts: '2026-09-01T10:00:00Z', chapter: '04.docx', tool: 'draft_section', kind: 'prose', provider: 'gemini', model: 'gemini-2.5-flash', sources: 2 },
      { ts: '2026-09-03T10:00:00Z', chapter: '02.docx', tool: 'run_task', kind: 'formalize', provider: 'gemini', model: 'gemini-2.5-flash' },
    ]);
    const events: Array<Record<string, unknown>> = [];
    const { dispatch } = mk({ emitArtifact: (ev) => events.push(ev as Record<string, unknown>) });
    const r = await dispatch('compile_ai_disclosure', { title: 'مقدمة' }) as { file: string; chaptersCovered: number; entries: number; preview: string };
    expect(r).toMatchObject({ file: 'AI-DISCLOSURE.md', chaptersCovered: 2, entries: 2 });
    const [root, name, body] = writeAssetText.mock.calls[0] as unknown as [string, string, string];
    expect([root, name]).toEqual(['C:\\p', 'AI-DISCLOSURE.md']);
    expect(body).toContain('«مقدمة»');
    expect(body).toContain('04.docx');
    expect(events.some((e) => e.op === 'delta')).toBe(true);
  });
});

describe('research_topic (bounded sub-run, M9 Phase E)', () => {
  it('needs a model — a clear message when headless', async () => {
    const { dispatch } = mk();
    expect(await dispatch('research_topic', { topic: 'النية في العبادات' })).toMatchObject({ error: /Agent panel/ });
  });

  it('runs a short read-only sub-loop, feeds THIS ledger, and returns a distilled result', async () => {
    // The sub-model: one search, then a synthesis answer.
    let call = 0;
    const model = vi.fn(async () => (call++ === 0
      ? { kind: 'toolCall' as const, name: 'search_corpus', args: { query: 'النية' } }
      : { kind: 'text' as const, text: 'المصادر متفقة على أن النية شرط. أقواها: الإحياء.' }));

    const { dispatch, ledger } = mk({ model });
    const r = await dispatch('research_topic', { topic: 'النية في العبادات', focus: 'الحنفية' }) as {
      sourcesAdded: number; synthesis: string; sources: Array<{ id: string }>; note: string;
    };

    expect(model).toHaveBeenCalled();
    expect(r.sourcesAdded).toBeGreaterThan(0);
    expect(r.synthesis).toContain('النية شرط');
    expect(r.note).toMatch(/insert_footnote/);
    // the sub-run's finds are now citable by the PARENT
    const sid = r.sources[0].id;
    const fn = await dispatch('insert_footnote', { chapter: '01.docx', marker: '[1]', source_id: sid }) as { applied: number };
    expect(fn.applied).toBe(1);
    expect(ledger.size).toBeGreaterThan(0);
  });

  it('the sub-run cannot call a write tool or recurse into research_topic', async () => {
    const model = vi.fn(async (_m: unknown, tools: Array<{ name: string }>) => {
      const names = tools.map((t) => t.name);
      expect(names).not.toContain('insert_footnote');
      expect(names).not.toContain('draft_section');
      expect(names).not.toContain('research_topic');
      return { kind: 'text' as const, text: 'no sources found — واللہ اعلم' };
    });
    const { dispatch } = mk({ model });
    const r = await dispatch('research_topic', { topic: 'x' }) as { sourcesAdded: number; note: string };
    expect(r.sourcesAdded).toBe(0);
    expect(r.note).toMatch(/No page-precise sources/);
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
