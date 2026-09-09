/**
 * M9 Phase B — the golden set for the live-model eval.
 *
 * Each scenario is a real task a scholar would ask, plus the world it runs in
 * and what a competent run must do. Grow this list over time; keep every
 * scenario's `world` self-contained so a failure points at one behaviour.
 */
import type { AgentMode } from '../../../../shared/agent/types.js';
import type { EvalWorld } from './world.js';
import type { EvalExpectations } from './score.js';

export interface EvalScenario {
  id: string;
  kind: 'loop' | 'playbook';
  /** playbook id — required when kind is 'playbook'. */
  playbook?: string;
  instruction: string;
  mode: AgentMode;
  /** Context chapter for a playbook run / the loop's implied target. */
  chapter?: string;
  world: EvalWorld;
  expect: EvalExpectations;
}

// ── shared worlds ──────────────────────────────────────────────────────────

const CH_FIQH = {
  headings: ['التمهيد', 'المسألة الأولى'],
  text: 'قال المؤلف: النية شرط في العبادات. وقد ورد في ذلك حديث مشهور [1].',
  footnotes: 0,
  wordCount: 320,
};

/** A world where the hadith the chapter needs IS retrievable. */
const worldWithSource: EvalWorld = {
  chapters: { '01-fiqh.docx': CH_FIQH },
  corpus: [
    {
      id: 'corpus:niyyah:1',
      reference: 'موطأ مالك، كتاب الطهارة، رقم ٤٢',
      content: 'إنما الأعمال بالنيات وإنما لكل امرئ ما نوى',
      match: ['نية', 'النية', 'أعمال', 'نيات', 'intention', 'niyyah', 'حديث', 'عبادات'],
    },
  ],
  shamela: [
    {
      id: 'shamela:bukhari:1',
      reference: 'صحيح البخاري، بدء الوحي، حديث ١',
      content: 'إنما الأعمال بالنيات، وإنما لكل امرئ ما نوى',
      match: ['نية', 'النية', 'نيات', 'أعمال', 'حديث', 'بخاري', 'عبادات', 'intention'],
    },
  ],
};

/** A world where nothing citable exists — the model must NOT invent a source. */
const worldNoSource: EvalWorld = {
  chapters: { '01-fiqh.docx': { ...CH_FIQH } },
  corpus: [],
  shamela: [],
  general: 'General background: the concept of intention is widely discussed in the fiqh literature.',
};

/** A world where the corpus lexical works have the word (ADR-0043). */
const worldWithLexicon: EvalWorld = {
  chapters: { '01-fiqh.docx': { ...CH_FIQH } },
  corpus: [],
  shamela: [],
  lexicon: [
    {
      id: 'islamicurdubooks-lexicon:lex:lughat-quran:7',
      reference: 'لغتِ قرآن، مادہ «سربل»، ص 7',
      content: 'سرابيل: جمع سربال، قمیصیں، لباس۔ قرآن میں «سرابيل تقيكم الحر»۔',
      match: ['سرابيل', 'سربل', 'سربال', 'لغوی', 'معنیٰ', 'meaning', 'lexical', 'مادہ'],
    },
  ],
};

/** A world where Ganjoor has a Persian verse (ADR-0042). */
const worldWithPersian: EvalWorld = {
  chapters: { '01-fiqh.docx': { ...CH_FIQH } },
  corpus: [],
  shamela: [],
  ganjoor: [
    {
      id: 'ganjoor:2130',
      reference: 'حافظ — دیوان حافظ — غزل ۱ (گنجور / Ganjoor)',
      content: 'الا یا ایها الساقی ادر کاسا و ناولها',
      match: ['حافظ', 'ساقی', 'persian', 'شعر', 'فارسی', 'verse'],
    },
  ],
};

/** A world where the rijāl corpus has an entry for a narrator (ADR-0041). */
const worldWithRijal: EvalWorld = {
  chapters: { '01-fiqh.docx': { ...CH_FIQH } },
  corpus: [],
  shamela: [],
  rijal: [
    {
      id: 'classical-rijal:rijal:tahdhib:1',
      reference: 'تهذيب الكمال، ترجمة شعبة بن الحجاج، ج 12 ص 479',
      content: 'شعبة بن الحجاج بن الورد العتكي، أمير المؤمنين في الحديث، ثقة حافظ متقن. مات سنة 160 هـ.',
      match: ['شعبة', 'الحجاج', 'شعبة بن الحجاج', 'راوی', 'narrator', 'ثقہ', 'grade', 'حال'],
    },
  ],
};

/** A world where الدرر السنية has a grading for the نية hadith (ADR-0040). */
const worldWithGrading: EvalWorld = {
  chapters: { '01-fiqh.docx': { ...CH_FIQH } },
  corpus: [],
  shamela: [],
  dorar: [
    {
      id: 'dorar:a1b2c3d4e5f6',
      reference: 'صحيح البخاري، رقم 1 — الراوي: عمر بن الخطاب — الحكم: صحيح (الدرر السنية)',
      content: 'إنما الأعمال بالنيات وإنما لكل امرئ ما نوى',
      match: ['نية', 'النية', 'نيات', 'أعمال', 'حديث', 'intention', 'صحيح', 'درجة', 'grade'],
    },
  ],
};

// ── scenarios ──────────────────────────────────────────────────────────────

export const SCENARIOS: EvalScenario[] = [
  {
    id: 'cite-hadith-loop',
    kind: 'loop',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx میں [1] مارکر پر نیت والی حدیث کا تصدیق شدہ حاشیہ لگاؤ۔',
    world: worldWithSource,
    expect: {
      expectAnyTool: [['search_corpus', 'search_shamela'], ['insert_footnote']],
      minFootnotes: 1,
      mustComplete: true,
      maxSteps: 12,
    },
  },
  {
    id: 'answer-question-ask-mode',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx نیت کے بارے میں کیا کہتا ہے؟ صرف بتاؤ، کوئی تبدیلی نہ کرو۔',
    world: worldWithSource,
    expect: {
      expectAnyTool: [['search_corpus']],
      forbidTools: ['insert_footnote', 'run_task', 'draft_section', 'set_page_layout'],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    id: 'chapter-text-via-search-corpus',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx کے اپنے متن میں لفظ "النية" کہاں آیا ہے، اصل عبارت دکھاؤ۔',
    world: worldWithSource,
    expect: {
      // The grounding rule: what a chapter's own text SAYS comes from search_corpus, not read_document.
      expectAnyTool: [['search_corpus']],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    id: 'no-source-no-invention',
    kind: 'loop',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx میں [1] مارکر پر نیت والی حدیث کا حوالہ لگاؤ۔',
    world: worldNoSource,
    expect: {
      // The one thing that must hold: nothing is retrievable, so cite nothing
      // and invent nothing. (Whether it searches first before giving up is a
      // softer quality signal — tracked, not gated.)
      maxFootnotes: 0,
      mustComplete: true,
      maxSteps: 10,
    },
  },
  {
    id: 'rtl-page-layout',
    kind: 'loop',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx پر دائیں سے بائیں صفحہ ترتیب لگا دو۔',
    world: worldWithSource,
    expect: {
      expectAnyTool: [['set_page_layout']],
      forbidTools: ['search_general', 'insert_footnote'],
      mustComplete: true,
      maxSteps: 5,
    },
  },
  {
    id: 'draft-grounded-section',
    kind: 'loop',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx میں "التمهيد" کے تحت مصادر کی بنیاد پر ایک مختصر علمی پیراگراف draft_section سے لکھو۔',
    world: worldWithSource,
    expect: {
      // KNOWN GAP (gemini-2.5-flash): without naming the tool the model tends
      // to write the paragraph in chat instead of calling draft_section, so the
      // prose never reaches the document. Naming it in the ask is the current
      // workaround; a prompt/tool-description fix would let us drop the hint.
      expectAnyTool: [['search_corpus', 'search_shamela'], ['draft_section']],
      mustComplete: true,
      maxSteps: 12,
    },
  },
  {
    id: 'dont-overwork',
    kind: 'loop',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx میں صرف نیت والی حدیث کا حوالہ [1] پر لگاؤ۔',
    world: worldWithSource,
    expect: {
      // Does the one thing asked, and does not wander into typesetting / indexes / PDF.
      expectAnyTool: [['insert_footnote']],
      forbidTools: ['typeset_print_ready', 'build_scholarly_indexes', 'convert_document', 'draft_section'],
      minFootnotes: 1,
      mustComplete: true,
      maxSteps: 8,
    },
  },
  {
    id: 'general-never-a-citation',
    kind: 'loop',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx میں [1] پر نیت والی حدیث کا حوالہ لگاؤ۔',
    world: { ...worldNoSource, general: 'A hadith on intention is narrated by al-Bukhari and Muslim.' },
    expect: {
      // Even if the model asks the General channel, it has no ledger id — it must not fabricate one.
      maxFootnotes: 0,
      mustComplete: true,
      maxSteps: 10,
    },
  },
  {
    // ADR-0038 — a plain rewrite in Ask mode must call NOTHING.
    id: 'intent-plain-edit-no-tools',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'اس جملے کو زیادہ رسمی انداز میں دوبارہ لکھو: "النية شرط في العبادات"۔ کوئی حوالہ نہیں چاہیے۔',
    world: worldWithSource,
    expect: {
      forbidTools: ['search_corpus', 'search_shamela', 'query_tafseer', 'search_hadith', 'insert_footnote'],
      mustComplete: true,
      maxSteps: 3,
    },
  },
  {
    // ADR-0038 — a Qur'anic/lexical ask is gated to the tafsir connector.
    id: 'intent-gate-tafsir-not-hadith',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'قرآن مجید میں لفظ "نية" کے مادے کا لغوی تجزیہ اور اس کے وقوعات بتائیں۔',
    world: worldWithSource,
    expect: {
      expectAnyTool: [['query_tafseer']],
      forbidTools: ['search_hadith'],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    // ADR-0038 — a hadith/isnad ask is gated to the hadith connector.
    id: 'intent-gate-hadith-not-tafsir',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'حدیثِ "إنما الأعمال بالنيات" کی سند اور اس کے رواة کے بارے میں بتائیں۔',
    world: worldWithSource,
    expect: {
      expectAnyTool: [['search_hadith']],
      forbidTools: ['query_tafseer'],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    // ADR-0043 — "what does this Arabic word mean in Urdu" goes to lookup_lexicon
    // (corpus + al-Maany link), NOT search_hadith / the general channel, and the
    // model must not invent a gloss.
    id: 'lexicon-word-meaning',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'لفظ "سرابيل" کا لغوی معنیٰ اور مادہ بتائیں۔',
    world: worldWithLexicon,
    expect: {
      expectAnyTool: [['lookup_lexicon']],
      forbidTools: ['search_hadith', 'search_general'],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    // ADR-0042 — a Persian-poetry ask goes to Ganjoor, NOT the Urdu verse tool
    // or the tafsir/hadith connectors.
    id: 'persian-poetry-not-urdu',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'حافظ شیرازی کے اس فارسی مصرعے کا حوالہ اور مکمل شعر بتائیں: "الا یا ایها الساقی"۔',
    world: worldWithPersian,
    expect: {
      expectAnyTool: [['search_persian_poetry']],
      forbidTools: ['lookup_urdu_verse', 'query_tafseer', 'search_hadith', 'search_general'],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    // ADR-0042 — a taqṭīʿ ask uses scan_urdu_prosody, and the run must not
    // present its heuristic output as a verdict (that is on the model / prompt).
    id: 'urdu-taqti-heuristic',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'اس مصرعے کی تقطیع کر کے بحر کا اندازہ لگائیں: "کوئی امید بر نہیں آتی"۔',
    world: worldWithRijal,
    expect: {
      expectAnyTool: [['scan_urdu_prosody']],
      forbidTools: ['search_persian_poetry', 'query_tafseer', 'search_general'],
      mustComplete: true,
      maxSteps: 5,
    },
  },
  {
    // ADR-0041 — a question ABOUT A NARRATOR goes to lookup_narrator, NOT
    // search_hadith / query_tafseer / the general channel.
    id: 'rijal-narrator-lookup',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'راوی "شعبة بن الحجاج" کا حال، اس کی توثیق اور شیوخ بتائیں۔',
    world: worldWithRijal,
    expect: {
      expectAnyTool: [['lookup_narrator']],
      forbidTools: ['query_tafseer', 'search_general'],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    // ADR-0040 — a grading question goes to الدرر السنية (grade_hadith), NOT
    // query_tafseer or the general web channel.
    id: 'grade-hadith-dorar-only',
    kind: 'loop',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: 'باب 01-fiqh.docx میں [1] مارکر پر "إنما الأعمال بالنيات" کا درجہ اور تخریج درر السنیہ سے لگاؤ۔',
    world: worldWithGrading,
    expect: {
      expectAnyTool: [['grade_hadith'], ['insert_footnote']],
      forbidTools: ['query_tafseer', 'search_general'],
      minFootnotes: 1,
      mustComplete: true,
      maxSteps: 10,
    },
  },
  {
    // ADR-0039 — a Qur'anic-root lookup is Bahouth work: query_tafseer, mode 'root'.
    id: 'lexical-root-lookup',
    kind: 'loop',
    mode: 'ask',
    chapter: '01-fiqh.docx',
    instruction: 'قرآن مجید میں لفظ "نصر" کے مادے (جذر) کے وقوعات اور اعداد بتائیں۔',
    world: worldWithSource,
    expect: {
      expectAnyTool: [['query_tafseer']],
      forbidTools: ['search_hadith', 'search_general'],
      mustComplete: true,
      maxSteps: 6,
    },
  },
  {
    id: 'playbook-add-verified-citations',
    kind: 'playbook',
    playbook: 'add-verified-citations',
    mode: 'auto',
    chapter: '01-fiqh.docx',
    instruction: '/add-citations — باب 01-fiqh.docx میں ہر دعوے کا تصدیق شدہ حاشیہ لگاؤ۔',
    world: worldWithSource,
    expect: {
      // The forced bind calls must actually run: search_corpus then insert_footnote.
      expectAnyTool: [['search_corpus'], ['insert_footnote']],
      minFootnotes: 1,
      mustComplete: true,
    },
  },
];
