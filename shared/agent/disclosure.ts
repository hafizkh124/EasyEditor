/**
 * M9 (blueprint §3, optional) — the AI-assistance disclosure statement.
 *
 * 2026 citation norms (APA 7 update, MLA, Chicago 18) ask an author to
 * disclose where a manuscript used AI assistance. EasyEditor already knows
 * this precisely: every `draft_section` write is the agent generating prose,
 * and every substantive `run_task` (paraphrase / summarize / formalize …) is
 * the agent rewriting it. `electron/agent/disclosure.ts` records one ledger
 * line per such write; this pure module turns the ledger into a front-matter
 * statement the scholar reviews, edits, and places in the book.
 *
 * It records that AI was USED — it never asserts the scholar failed to review
 * it. Every recorded change landed as a tracked change the scholar accepted or
 * rejected, and the statement says so.
 *
 * Pure — no runtime globals.
 */
import { getProvider } from './providers.js';

/** File name for the compiled statement in the project root (ASCII, like RULES.md). */
export const AI_DISCLOSURE_FILE = 'AI-DISCLOSURE.md';

/** The ledger file under `.easyeditor/` (next to journal.jsonl). */
export const AI_DISCLOSURE_LEDGER = 'ai-disclosure.jsonl';

/**
 * `run_task` slugs that count as disclosed REWRITING — the substantive passes.
 * The mechanical ones (add_harakat, spelling_check, normalize_script,
 * auto_format) are not disclosed for the same reason a spell-checker is not:
 * they fix one thing and change nothing else. This is exactly the
 * author-voice-shaped set (authorVoice.ts VOICE_SHAPED_TASKS) — the passes that
 * touch the prose itself.
 */
export const DISCLOSED_TASKS = new Set<string>([
  'formalize', 'humanize', 'paraphrase', 'shorten', 'summarize', 'summarize_sections',
]);

/** One recorded act of AI assistance on one chapter. */
export interface DisclosureEntry {
  /** ISO timestamp of the run that produced it. */
  ts: string;
  /** The chapter file the change landed in. */
  chapter: string;
  /** 'draft_section' (new prose) or 'run_task' (rewriting). */
  tool: 'draft_section' | 'run_task';
  /** The draft_section mode, or the run_task slug. */
  kind: string;
  /** Provider id (providers.ts) that generated the text. */
  provider: string;
  /** The model name that generated the text. */
  model: string;
  /** draft_section — how many retrieved sources the draft was grounded on. */
  sources?: number;
}

function fmtDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** `Provider Label (model)` for each distinct provider/model pair, sorted. */
export function modelsUsed(entries: DisclosureEntry[]): string[] {
  return uniq(entries.map((e) => `${getProvider(e.provider).label} (${e.model})`)).sort();
}

interface ChapterGroup {
  chapter: string;
  draftKinds: string[];
  rewriteKinds: string[];
}

function groupByChapter(entries: DisclosureEntry[]): ChapterGroup[] {
  const byChapter = new Map<string, ChapterGroup>();
  for (const e of entries) {
    let g = byChapter.get(e.chapter);
    if (!g) { g = { chapter: e.chapter, draftKinds: [], rewriteKinds: [] }; byChapter.set(e.chapter, g); }
    (e.tool === 'draft_section' ? g.draftKinds : g.rewriteKinds).push(e.kind);
  }
  return [...byChapter.values()]
    .map((g) => ({ ...g, draftKinds: uniq(g.draftKinds).sort(), rewriteKinds: uniq(g.rewriteKinds).sort() }))
    .sort((a, b) => a.chapter.localeCompare(b.chapter));
}

export interface DisclosureOptions {
  /** The book title, if the scholar passed one — used in the opening line. */
  projectTitle?: string;
}

/**
 * A bilingual (Urdu + English) front-matter statement, built deterministically
 * from the ledger — no model call. Returns markdown.
 */
export function buildDisclosureStatement(entries: DisclosureEntry[], opts: DisclosureOptions = {}): string {
  const groups = groupByChapter(entries);
  const drafted = groups.filter((g) => g.draftKinds.length > 0);
  const rewritten = groups.filter((g) => g.rewriteKinds.length > 0);
  const models = modelsUsed(entries);
  const dates = entries.map((e) => fmtDate(e.ts)).sort();
  const period = dates.length === 0
    ? ''
    : dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} – ${dates[dates.length - 1]}`;
  const bookUr = opts.projectTitle ? `«${opts.projectTitle}» ` : 'اس کتاب ';
  const bookEn = opts.projectTitle ? `"${opts.projectTitle}"` : 'this book';

  const ur: string[] = [
    '# اعترافِ معاونتِ مصنوعی ذہانت',
    '',
    '<!-- EasyEditor نے یہ بیان اپنے خودکار ریکارڈ سے تیار کیا ہے۔ نظرِ ثانی کر کے،',
    '     ضرورت کے مطابق ترمیم کر کے، کتاب کے ابتدائیے میں شامل کر لیں۔ -->',
    '',
    `${bookUr}کی تیاری میں مصنف نے EasyEditor کے اندر ایک مصنوعی ذہانت کے معاون سے مدد لی۔ ` +
      'ہر تجویز کردہ تبدیلی مصنف کے سامنے «ٹریک چینجز» کے طور پر آئی، جسے مصنف نے دیکھ کر قبول یا رد کیا۔',
  ];
  if (drafted.length) {
    ur.push('', '## نئی تحریر کا مسودہ (AI drafting)');
    for (const g of drafted) ur.push(`- **${g.chapter}** — ${g.draftKinds.join('، ')}`);
  }
  if (rewritten.length) {
    ur.push('', '## موجودہ متن کی اصلاح و تلخیص (AI rewriting)');
    for (const g of rewritten) ur.push(`- **${g.chapter}** — ${g.rewriteKinds.join('، ')}`);
  }
  ur.push('');
  if (models.length) ur.push(`**استعمال شدہ ماڈل:** ${models.join('، ')}`);
  if (period) ur.push(`**مدت:** ${period}`);

  const en: string[] = [
    '## AI Assistance Disclosure',
    '',
    `In preparing ${bookEn}, the author used an AI assistant within EasyEditor. Every suggested ` +
      'change was presented as a tracked change for the author to review and accept or reject.',
  ];
  if (drafted.length) {
    en.push('', '**AI drafting:**');
    for (const g of drafted) en.push(`- ${g.chapter} (${g.draftKinds.join(', ')})`);
  }
  if (rewritten.length) {
    en.push('', '**AI rewriting:**');
    for (const g of rewritten) en.push(`- ${g.chapter} (${g.rewriteKinds.join(', ')})`);
  }
  en.push('');
  if (models.length) en.push(`**Model(s):** ${models.join('; ')}`);
  if (period) en.push(`**Period:** ${period}`);
  en.push(
    '',
    'This statement was generated from EasyEditor\'s automatic ledger. It is a factual record, not ' +
      'legal or journal-policy advice — check your publisher\'s or institution\'s specific ' +
      'AI-disclosure requirements.',
  );

  return `${ur.join('\n')}\n\n---\n\n${en.join('\n')}\n`;
}
