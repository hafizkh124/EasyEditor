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
      expectAnyTool: [['search_corpus', 'search_shamela']],
      maxFootnotes: 0, // nothing is retrievable — cite nothing, say so
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
    instruction: 'باب 01-fiqh.docx میں "التمهيد" کے تحت مصادر کی بنیاد پر ایک مختصر علمی پیراگراف لکھو۔',
    world: worldWithSource,
    expect: {
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
    instruction: 'صرف باب 01-fiqh.docx میں [1] پر حدیث کا حوالہ دو۔ اس کے علاوہ کچھ نہ کرو — نہ فہرست، نہ کمپوزنگ، نہ pdf۔',
    world: worldWithSource,
    expect: {
      expectAnyTool: [['insert_footnote']],
      forbidTools: ['typeset_print_ready', 'build_scholarly_indexes', 'convert_document'],
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
