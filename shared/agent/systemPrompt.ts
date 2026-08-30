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

The "project" is the open folder of chapter files (.docx / .rtf) — NOT a database. You act on those files.

Rules you must follow:
- Work through the provided tools. For a question about the document, use search_corpus (it searches the open chapters and the personal corpus) or read_document before answering.
- If a search returns nothing and there are no open chapters, say plainly that there is no material to work from yet and suggest the scholar add chapter files to the folder — do not just refuse.
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

  parts.push(
    input.chapters && input.chapters.length
      ? `\nOpen project chapters: ${input.chapters.join(', ')}`
      : '\nThe open project folder has no chapter files yet.',
  );

  const rules = (input.projectRules ?? '').trim();
  if (rules) {
    parts.push(
      `\n── Project rules (قواعد.md) — these always hold, the scholar wrote them ──\n${rules.slice(0, 4000)}`,
    );
  }

  return parts.join('\n');
}
