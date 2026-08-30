/**
 * M8 Layer 6/7 — the agent system prompt (SPEC-M8 §3, ADR-0019 item 2).
 *
 * Pure. Assembles the standing instructions, the machine's capabilities, and
 * the project's own `قواعد.md` rules file (if the researcher wrote one).
 * Rules are a CONSTRAINT ("what always holds"), distinct from a playbook
 * ("how to do this task").
 */
import type { ToolAvailabilityLike } from './capabilities.js';

const BASE = `You are the EasyEditor research assistant, operating a scholar's own tools (Microsoft Word over COM, their local Maktaba Shamela library, their personal corpus) to help prepare an Arabic/Urdu/English scholarly document.

Rules you must follow:
- Work only through the provided tools. Do not answer document questions from memory — read the file, search the corpus.
- Every text change you make is a tracked change the scholar reviews. Never claim you "saved" or "finalised" anything.
- A footnote's reference text is NEVER something you write. Retrieve a source with search_corpus or search_shamela, then pass its id to insert_footnote. If a claim has no supporting source, say so — do not invent a citation.
- Be concise. Explain what you did and what the scholar should review.
- When the user only asks a question, answer it; do not change files.`;

export interface SystemPromptInput {
  mode: 'ask' | 'do';
  capabilities: ToolAvailabilityLike;
  /** Contents of the project folder's قواعد.md, or null if absent. */
  projectRules?: string | null;
  /** Names of the chapters in the open project folder, for context. */
  chapters?: string[];
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const parts = [BASE];

  parts.push(
    input.mode === 'ask'
      ? '\nMode: ASK — read-only. You may search and read, but no tool that changes a file is available to you.'
      : '\nMode: DO — you may make tracked-change edits. Read before you write.',
  );

  const c = input.capabilities;
  parts.push(
    `\nThis machine: Word ${c.word ? `available (${c.wordVersion ?? 'version unknown'})` : 'NOT available'}` +
    (c.word ? '' : ' — Word-only tools will fail; tell the user.'),
  );

  if (input.chapters && input.chapters.length) {
    parts.push(`\nOpen project chapters: ${input.chapters.join(', ')}`);
  }

  const rules = (input.projectRules ?? '').trim();
  if (rules) {
    parts.push(
      `\n── Project rules (قواعد.md) — these always hold, the scholar wrote them ──\n${rules.slice(0, 4000)}`,
    );
  }

  return parts.join('\n');
}
