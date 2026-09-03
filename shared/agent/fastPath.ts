/**
 * M9 ADR-0027 F1 — the fast path.
 *
 * Not every ask needs the agentic loop. A pure linguistic / editing request on
 * one named chapter (اعراب, spelling, paraphrase, summary, auto-format …) maps
 * to a single `run_task` call — no tool selection, no retrieval, no model
 * round-trips to pick a plan. This detects those and returns the direct call;
 * everything else returns null and runs the normal loop.
 *
 * The fast path still WRITES (a tracked change), so the caller must still open
 * a checkpoint and back the chapter up — exactly as the loop path does.
 *
 * Pure — no runtime globals.
 */
import { resolveTaskSlug } from './textTasks.js';

export interface FastPathTask {
  kind: 'run_task';
  task: string;
  chapter: string;
}

/**
 * Verb phrases that map to a text task, most specific first. No `\b` — it is
 * ASCII-only in JS regex and never matches an Arabic/Urdu word edge.
 */
const TASK_HINTS: Array<{ re: RegExp; task: string }> = [
  { re: /(اعراب|حرکات|تشکیل|harakat|tashkeel|diacritics|voweli[sz]e)/i, task: 'harakat' },
  { re: /(املا|ہجے|spelling|spell[-\s]?check|typos?)/i, task: 'spelling' },
  { re: /(auto[-\s]?format|فارمیٹ|formatting|clean up the formatting)/i, task: 'auto-format' },
  { re: /(section[-\s]?summar|ہر (باب|عنوان) کا خلاصہ|عناوین کا خلاصہ)/i, task: 'section-summaries' },
  { re: /(paraphrase|دوبارہ لکھ|الفاظ بدل|reword)/i, task: 'paraphrase' },
  { re: /(خلاصہ|summar[iy]|تلخیص)/i, task: 'summarize' },
  { re: /(formali[sz]e|رسمی بنا|academic tone)/i, task: 'formalize' },
  { re: /(shorten|مختصر کر|condense)/i, task: 'shorten' },
  { re: /(normali[sz]e (the )?script|رسم الخط یکساں)/i, task: 'normalize' },
];

/**
 * A phrase that means "and also cite / research / verify" disqualifies the fast
 * path — those need the loop.
 */
const NEEDS_LOOP = /(cite|citation|footnote|حوالہ|حاشیہ|تخریج|verify|research|\bsource\b|مراجع|takhrij|sanad|isnad)/i;

export interface FastPathContext {
  /** Chapter names in the open project folder. */
  chapters: string[];
}

/**
 * Returns a direct `run_task` call when the instruction is unambiguously one
 * text task on one identifiable chapter; null otherwise.
 */
export function detectFastPath(instruction: string, ctx: FastPathContext): FastPathTask | null {
  const text = instruction.trim();
  if (!text || NEEDS_LOOP.test(text)) return null;

  const hint = TASK_HINTS.find((h) => h.re.test(text));
  if (!hint) return null;
  if (!resolveTaskSlug(hint.task)) return null;

  // Which chapter? An @mention or a bare chapter filename in the text.
  const chapter = pickChapter(text, ctx.chapters);
  if (!chapter) return null;

  // A long instruction with several clauses is probably not a one-task ask.
  if (text.split(/[.،؛\n]/).filter((s) => s.trim().length > 3).length > 2) return null;

  return { kind: 'run_task', task: hint.task, chapter };
}

function pickChapter(text: string, chapters: string[]): string | null {
  if (chapters.length === 1 && /(this|the |is chapter|اس (باب|فائل)|موجودہ|یہ باب)/i.test(text)) return chapters[0];
  const lower = text.toLowerCase();
  const named = chapters.find((c) => lower.includes(c.toLowerCase()) || lower.includes(c.replace(/\.[^.]+$/, '').toLowerCase()));
  if (named) return named;
  if (chapters.length === 1) return chapters[0];
  return null;
}
