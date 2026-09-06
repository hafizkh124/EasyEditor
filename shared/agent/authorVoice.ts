/**
 * M9 Phase A — the author's own writing voice (طرز_تحریر.md).
 *
 * A scholar-authored file read from the project root, exactly like قواعد.md —
 * the same read / cap-length / inject-into-prompt mechanism. The two are
 * distinct in KIND:
 *   - قواعد.md is a CONSTRAINT ("what always holds" — citation style, madhhab,
 *     numbering) and stays the strongest instruction, closest to the end of
 *     the prompt.
 *   - طرز_تحریر.md is a STYLE brief ("how the prose should sound" — register,
 *     sentence rhythm, connectives, recurring terminology). It is guidance,
 *     not a rule, and it shapes ONLY generative writing.
 *
 * It never touches a mechanical pass (harakat, spell-check, script
 * normalisation, auto-format): those must not be nudged toward anyone's
 * phrasing. See VOICE_SHAPED_TASKS for the run_task slugs it applies to.
 *
 * Pure — no runtime globals.
 */

/** Candidate file names in the project root, first match wins (mirrors RULES_FILES). */
export const AUTHOR_VOICE_FILES = ['طرز_تحریر.md', 'طرز-تحریر.md', 'tarz.md', 'VOICE.md'];

/** Hard cap on how much of the file reaches a prompt (mirrors the 4000-char قواعد.md cap). */
export const AUTHOR_VOICE_MAX_CHARS = 3000;

/**
 * The `run_task` slugs whose output is shaped by the author's voice — the
 * rewriting / condensing tasks. The mechanical slugs (add_harakat,
 * spelling_check, normalize_script, auto_format) are deliberately absent:
 * their whole point is to change nothing but the one thing they fix.
 */
export const VOICE_SHAPED_TASKS = new Set<string>([
  'formalize', 'humanize', 'paraphrase', 'shorten', 'summarize', 'summarize_sections',
]);

/**
 * The system-prompt section for the author's voice, or `null` when the project
 * has no طرز_تحریر.md. Placed after the playbook guidance and BEFORE the
 * قواعد.md section so the rules keep the last word.
 */
export function authorVoicePromptSection(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  return (
    '── مصنف کا اسلوب (طرز_تحریر.md) — the scholar\'s own writing voice ──\n' +
    'When you DRAFT or REWRITE prose, make it sound like the same hand wrote the rest of the book — ' +
    'match the register, sentence rhythm, connectives, and recurring terminology described here. ' +
    'This never overrides قواعد.md, the sources, or a citation marker, and it does NOT apply to a ' +
    'mechanical pass (diacritics, spelling, script, formatting).\n' +
    text.slice(0, AUTHOR_VOICE_MAX_CHARS)
  );
}

/**
 * Append the author's voice to a fixed generation instruction (draft_section's
 * mode template, or a voice-shaped run_task prompt), or return it unchanged
 * when there is no طرز_تحریر.md. The template is never replaced — this is an
 * addendum, so the closed-vocabulary guarantee (the caller passes only a mode,
 * never a prompt) still holds.
 */
export function withAuthorVoice(instruction: string, raw: string | null | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return instruction;
  return (
    `${instruction}\n\n` +
    "AUTHOR'S VOICE — write so the prose reads as the same author's hand: match the register, " +
    'sentence rhythm, connective style, and recurring terminology described below. Do NOT copy its ' +
    'example sentences verbatim, and do NOT let it change the meaning, the sources used, or the ' +
    'bare [n] citation markers:\n' +
    text.slice(0, AUTHOR_VOICE_MAX_CHARS)
  );
}
