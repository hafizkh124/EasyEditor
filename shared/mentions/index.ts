/**
 * M8 Layer 7 — `@` mentions (SPEC-M8 §3, ADR-0019 item 1).
 *
 * Typing `@` in the Agent chat surfaces the project's chapters (and, later,
 * Shamela books and the document outline). Picking one gives the agent an
 * EXPLICIT reference — a file name or a heading — so it doesn't have to guess
 * which file "@Ihya" means. Not a new tool: the mention text is appended to
 * the instruction, and the agent uses it as a parameter to the existing
 * `read_document` / `search_corpus` / `word.*` calls.
 *
 * Pure — no runtime globals.
 */

export type MentionKind = 'chapter' | 'heading' | 'shamela-book' | 'media' | 'scan' | 'asset';

export interface Mention {
  kind: MentionKind;
  /** What the user sees in the picker and what gets inserted (without the @). */
  label: string;
  /** The explicit reference the agent receives (file name, heading text, book id, in-project path). */
  ref: string;
}

export interface MentionSources {
  chapters?: string[];
  /** Headings from the currently open document, in order. */
  outline?: string[];
  shamelaBooks?: Array<{ id: string; title: string }>;
  /**
   * Non-chapter project files (M9 Phase 3) — `name` is the in-project path
   * (e.g. "media/lecture.mp3"), `kind` its category.
   */
  assets?: Array<{ name: string; kind: 'media' | 'scan' | 'asset' }>;
}

/** basename without the extension, for a readable picker label. */
function baseLabel(relPath: string): string {
  const file = relPath.split('/').pop() ?? relPath;
  return file;
}

export function buildMentions(sources: MentionSources): Mention[] {
  const out: Mention[] = [];
  for (const name of sources.chapters ?? []) {
    out.push({ kind: 'chapter', label: name, ref: name });
  }
  for (const h of sources.outline ?? []) {
    const label = h.trim();
    if (label) out.push({ kind: 'heading', label: `§ ${label}`, ref: label });
  }
  for (const b of sources.shamelaBooks ?? []) {
    out.push({ kind: 'shamela-book', label: b.title, ref: `shamela:${b.id}` });
  }
  for (const a of sources.assets ?? []) {
    out.push({ kind: a.kind, label: baseLabel(a.name), ref: a.name });
  }
  return out;
}

/** Filter mentions by the text typed after `@` (case-insensitive substring). */
export function filterMentions(mentions: Mention[], query: string): Mention[] {
  const q = query.trim().toLowerCase();
  if (!q) return mentions.slice(0, 20);
  return mentions.filter((m) => m.label.toLowerCase().includes(q) || m.ref.toLowerCase().includes(q)).slice(0, 20);
}

/**
 * Given the chat text and the caret position, return the active `@token`
 * (the run of non-space chars after the last `@` that the caret is inside),
 * or null. Used to drive the picker.
 */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  const between = upto.slice(at + 1);
  if (/\s/.test(between)) return null; // the @token ended before the caret
  if (at > 0 && !/\s/.test(text[at - 1])) return null; // @ must start a word
  return { query: between, start: at };
}

/**
 * Replace the active `@query` in `text` with `@<token> ` and return the new
 * text + caret. `token` is the mention's `ref` — the exact in-project path a
 * tool schema expects (e.g. "media/dars-01.mp3", not just "dars-01.mp3") —
 * for every kind except `shamela-book`, whose `ref` is an internal id
 * ("shamela:55") no tool actually takes; no tool has a Shamela-book-id
 * parameter (search_shamela only takes free-text query), so the title
 * (`label`) is what is actually useful there.
 */
export function applyMention(text: string, caret: number, mention: Mention): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret);
  if (!active) return { text, caret };
  const before = text.slice(0, active.start);
  const after = text.slice(caret);
  const token = mention.kind === 'shamela-book' ? mention.label : mention.ref;
  const insert = `@${token} `;
  return { text: before + insert + after, caret: (before + insert).length };
}
