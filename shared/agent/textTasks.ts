/**
 * M8 Layer 6 — the agent's `run_task` slug map (SPEC-M8 §3, ADR-0016 c1).
 *
 * The agent names tasks with friendly words ("harakat", "auto-format"); the
 * built-in text tasks and their prompts (shared/ai/prompts/refineText.ts) use
 * slugs ("add_harakat", "auto_format"). This maps one to the other so
 * `run_task` runs the SAME prompt the editor's task buttons run.
 *
 * Pure — no runtime globals.
 */
import { REFINE_TEXT_ACTIONS } from '../ai/prompts/refineText.js';

/** friendly name (and the real slug itself) → REFINE_TEXT_ACTIONS key. */
const ALIASES: Record<string, string> = {
  harakat: 'add_harakat',
  tashkeel: 'add_harakat',
  diacritics: 'add_harakat',
  spelling: 'spelling_check',
  spellcheck: 'spelling_check',
  normalize: 'normalize_script',
  'normalize-script': 'normalize_script',
  paraphrase: 'paraphrase',
  summarize: 'summarize',
  summary: 'summarize',
  'section-summaries': 'summarize_sections',
  'section-summary': 'summarize_sections',
  'summarize-sections': 'summarize_sections',
  'auto-format': 'auto_format',
  autoformat: 'auto_format',
  format: 'auto_format',
  formalize: 'formalize',
  humanize: 'humanize',
  shorten: 'shorten',
  citations: 'citations', // sentinel — handled specially (no invented refs)
};

/**
 * Resolve a task the agent named to a runnable slug, or null. Accepts the
 * friendly aliases, the real REFINE_TEXT_ACTIONS keys, and 'citations' (which
 * the caller must reject — run_task never invents references).
 */
export function resolveTaskSlug(input: string): string | null {
  const k = String(input || '').trim().toLowerCase().replace(/\s+/g, '-');
  if (k === 'citations') return 'citations';
  const mapped = ALIASES[k] ?? ALIASES[k.replace(/-/g, '_')] ?? (k.replace(/-/g, '_') in REFINE_TEXT_ACTIONS ? k.replace(/-/g, '_') : null);
  return mapped;
}

/** Slugs whose output is an HTML fragment, not plain text. */
export function taskOutputIsHtml(slug: string): boolean {
  return slug === 'auto_format';
}

/** The friendly names the agent is told about, for error messages. */
export const RUN_TASK_NAMES = [
  'harakat', 'spelling', 'paraphrase', 'summarize', 'auto-format',
  'normalize', 'formalize', 'humanize', 'shorten', 'section-summaries',
];
