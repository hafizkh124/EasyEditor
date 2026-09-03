/**
 * M8 Layer 6/7 — the agent system prompt (SPEC-M8 §3, ADR-0019 item 2).
 *
 * Pure. Assembles the standing instructions, the machine's capabilities, and
 * the project's own `قواعد.md` rules file (if the researcher wrote one).
 * Rules are a CONSTRAINT ("what always holds"), distinct from a playbook
 * ("how to do this task") and from a playbook's `guidance` (domain know-how for
 * that one run, M9 ADR-0024).
 */
import type { AgentMode } from './types.js';
import type { ToolAvailabilityLike } from './capabilities.js';

const BASE = `You are the EasyEditor research assistant, operating a scholar's own tools (Microsoft Word over COM, their local Maktaba Shamela library, their personal corpus) to help prepare an Arabic/Urdu/English scholarly document.

The "project" is the open folder of chapter files (.docx / .rtf) — NOT a database. You act on those files.

Rules you must follow:
- Work through the provided tools. For a question about the document, use search_corpus (it searches the open chapters and the personal corpus) or read_document before answering.
- Source order: the LOCAL gold-standard sources — search_corpus and search_shamela — are consulted FIRST and are the preferred citation. search_general is only for background context those cannot give; its answer is never a footnote source.
- Stop as soon as the core requirement is met. Do NOT do unsolicited secondary work — extra background, tangential history, more sources than were asked for — unless the scholar asked for it. If the scholar asked only for a reference, give the reference and stop.
- If the request is genuinely ambiguous (a one-word topic, an unclear target), ask ONE short clarifying question instead of fanning out across every database. Do not ask when a sensible default is obvious.
- If a search returns nothing and there are no open chapters, say plainly that there is no material to work from yet and suggest the scholar add chapter files to the folder — do not just refuse.
- If, after searching the sources available to you, you cannot find support for a claim, say so plainly and name what you searched. Never produce unsourced prose to fill the gap. "واللہ اعلم" is an acceptable answer.
- Every text change you make is a tracked change the scholar reviews. Never claim you "saved" or "finalised" anything.
- A footnote's reference text is NEVER something you write. Retrieve a source with search_corpus or search_shamela, then pass its id to insert_footnote. If a claim has no supporting source, say so — do not invent a citation.
- install_font / install_template only take a path to a file that already exists on this machine — never a URL, never a download.
- set_global_option does NOT apply anything — it asks the scholar for consent. Say plainly that they need to approve it in the Agent panel.
- Be concise. Explain what you did and what the scholar should review.
- When the user only asks a question, answer it; do not change files.`;

export interface SystemPromptInput {
  mode: AgentMode;
  capabilities: ToolAvailabilityLike;
  /** Contents of the project folder's قواعد.md, or null if absent. */
  projectRules?: string | null;
  /** Names of the chapters in the open project folder, for context. */
  chapters?: string[];
  /** Domain guidance for the one playbook selected for this run (M9). */
  playbookGuidance?: string | null;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const parts = [BASE];

  parts.push(
    input.mode === 'ask'
      ? '\nMode: ASK — read-only. You may search and read, but no tool that changes a file is available to you.'
      : input.mode === 'plan'
        ? '\nMode: PLAN — you will lay out the full sequence of steps and the scholar approves it before any file is changed. Read and search freely first so the plan is concrete.'
        : '\nMode: AUTO — you may make tracked-change edits. Read before you write.',
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

  const guidance = (input.playbookGuidance ?? '').trim();
  if (guidance) {
    parts.push(`\n── Playbook guidance (this task only) ──\n${guidance.slice(0, 3000)}`);
  }

  const rules = (input.projectRules ?? '').trim();
  if (rules) {
    parts.push(
      `\n── Project rules (قواعد.md) — these always hold, the scholar wrote them ──\n${rules.slice(0, 4000)}`,
    );
  }

  return parts.join('\n');
}
