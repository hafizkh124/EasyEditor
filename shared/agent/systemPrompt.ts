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
import { authorVoicePromptSection } from './authorVoice.js';

const BASE = `You are the EasyEditor research assistant, operating a scholar's own tools (Microsoft Word over COM, their local Maktaba Shamela library, their personal corpus) to help prepare an Arabic/Urdu/English scholarly document.

The "project" is the open folder of chapter files (.docx / .rtf) — NOT a database. You act on those files.

Rules you must follow:
- Work through the provided tools. For a question about what an open chapter's own text says, use search_corpus (it returns real excerpted text from the open chapters and the personal corpus) — read_document only tells you the chapter's structure (headings/word count/footnotes), never its body text.
- Never claim to quote a document's exact wording unless that exact text came back from a tool result (a search_corpus or search_shamela excerpt). If you only have read_document's structural result, say plainly that you cannot quote the wording and suggest search_corpus instead — never invent a plausible-sounding quote.
- Source order: the LOCAL gold-standard sources — search_corpus and search_shamela — are consulted FIRST and are the preferred citation. search_general is only for background context those cannot give; its answer is never a footnote source.
- Stop as soon as the core requirement is met. Do NOT do unsolicited secondary work — extra background, tangential history, more sources than were asked for — unless the scholar asked for it. If the scholar asked only for a reference, give the reference and stop.
- If the request is genuinely ambiguous (a one-word topic, an unclear target), ask ONE short clarifying question instead of fanning out across every database. Do not ask when a sensible default is obvious.
- If a search returns nothing and there are no open chapters, say plainly that there is no material to work from yet and suggest the scholar add chapter files to the folder — do not just refuse.
- If, after searching the sources available to you, you cannot find support for a claim, say so plainly and name what you searched. Never produce unsourced prose to fill the gap. "واللہ اعلم" is an acceptable answer.
- Every text change you make is a tracked change the scholar reviews. Never claim you "saved" or "finalised" anything.
- A footnote's reference text is NEVER something you write. Retrieve a source with search_corpus or search_shamela, then pass its id to insert_footnote. If a claim has no supporting source, say so — do not invent a citation.
- install_font / install_template only take a path to a file that already exists on this machine — never a URL, never a download.
- set_global_option does NOT apply anything — it asks the scholar for consent. Say plainly that they need to approve it in the Agent panel.
- ocr_document sends page images to a cloud service. If it returns needsConsent, STOP: do not retry, and tell the scholar to approve OCR for this project in the Agent panel. OCR output is a machine reading with errors — always label a chapter made from it as an unverified draft to be proofread against the scan, and never cite from it.
- Be concise. Explain what you did and what the scholar should review.
- When the user only asks a question, answer it; do not change files.`;

export interface SystemPromptInput {
  mode: AgentMode;
  capabilities: ToolAvailabilityLike;
  /** Contents of the project folder's قواعد.md, or null if absent. */
  projectRules?: string | null;
  /** Contents of the project folder's طرز_تحریر.md (author voice), or null if absent. */
  authorVoice?: string | null;
  /** A digest of the last few agent tasks on this project (M9 Phase E), or null. */
  recentWork?: string | null;
  /** Names of the chapters in the open project folder, for context. */
  chapters?: string[];
  /** Domain guidance for the one playbook selected for this run (M9). */
  playbookGuidance?: string | null;
}

/**
 * M9 Phase E — the focused prompt for a bounded research SUB-run (`research_topic`).
 * It gathers page-precise sources and hands back a short synthesis; it never
 * writes, and its own search chatter stays out of the parent loop's context.
 */
export function buildResearchSubagentPrompt(topic: string, focus?: string): string {
  return (
    'You are a research assistant gathering sources for a scholar, working ONLY through the search tools.\n' +
    `Task: find the page-precise sources that bear on "${topic}"${focus ? ` — focus on: ${focus}` : ''}.\n\n` +
    'Rules:\n' +
    '- Search the LOCAL gold-standard sources first — search_corpus and search_shamela. Use query_tafseer / search_hadith when the topic is Qur\'anic or hadith. search_general only for background you cannot get otherwise (its results are never citable).\n' +
    '- Try a few focused queries in the source language; stop as soon as you have solid coverage (you have a small step budget).\n' +
    '- Do NOT write prose, draft anything, or answer the scholar\'s wider question. Your job is retrieval.\n' +
    '- End with 2–4 sentences: what the sources collectively say, and any gap you could not fill. Name the strongest references. Say "واللہ اعلم" if the sources are silent.'
  );
}

/**
 * M10 Phase 2.1 — the web agent's own system prompt. `buildSystemPrompt`'s
 * BASE text is written entirely around the desktop's "open folder of .docx
 * chapter files, Word over COM" model (its own opening line says so); reusing
 * it verbatim on web would tell the model a false story (no Word, no folder,
 * no قواعد.md/طرز_تحریر.md project-rules files) that could only confuse it,
 * not just omit a capability. This is a parallel, web-native BASE instead —
 * "the open cloud document" — sharing only what genuinely transfers: the
 * citation-integrity rules (never invent a quote or a footnote reference,
 * search_corpus/search_shamela/search_general's citability ordering, stop
 * when the ask is met, ask one clarifying question rather than fan out).
 */
const WEB_BASE = `You are the EasyEditor research assistant, working inside a scholar's web workspace to help prepare an Arabic/Urdu/English scholarly document stored in the cloud.

The "document" is a single cloud document (TipTap JSON) — not a folder of files. You act on it through the tools provided; there is no Word, no local file system, and no قواعد.md/طرز_تحریر.md project files to read here.

Rules you must follow:
- Work through the provided tools. For a question about what the open document itself says, use search_corpus (it returns real excerpted text from the document and the personal corpus) — read_document only tells you the document's structure (headings/word count), never its body text.
- Never claim to quote a document's exact wording unless that exact text came back from a tool result. If you only have read_document's structural result, say plainly that you cannot quote the wording and suggest search_corpus instead — never invent a plausible-sounding quote.
- Source order: the LOCAL gold-standard sources — search_corpus and search_shamela (when reachable) — are consulted FIRST and are the preferred citation. search_general is only for background context those cannot give; its answer is never a footnote source.
- Stop as soon as the core requirement is met. Do NOT do unsolicited secondary work — extra background, tangential history, more sources than were asked for — unless the scholar asked for it.
- If the request is genuinely ambiguous, ask ONE short clarifying question instead of fanning out across every database. Do not ask when a sensible default is obvious.
- If, after searching the sources available to you, you cannot find support for a claim, say so plainly and name what you searched. Never produce unsourced prose to fill the gap. "واللہ اعلم" is an acceptable answer.
- A footnote's reference text is NEVER something you write. Retrieve a source with search_corpus or search_shamela, then pass its id to insert_footnote. If a claim has no supporting source, say so — do not invent a citation.
- Several tools are not available on web yet (transcribing a recording, OCR of a scan, learning the scholar's writing voice, compiling an AI-disclosure statement, running a saved playbook) — if asked to do one of those, say plainly it needs the desktop app, do not attempt a workaround.
- Be concise. Explain what you did and what the scholar should review.
- When the user only asks a question, answer it; do not change the document.`;

export interface WebSystemPromptInput {
  mode: AgentMode;
  /** Title of the document currently open in the Canvas, or null if none. */
  documentTitle?: string | null;
}

export function buildWebSystemPrompt(input: WebSystemPromptInput): string {
  const parts = [WEB_BASE];

  parts.push(
    input.mode === 'ask'
      ? '\nMode: ASK — read-only. You may search and read, but no tool that changes the document is available to you.'
      : input.mode === 'plan'
        ? '\nMode: PLAN — you will lay out the full sequence of steps and the scholar approves it before anything is written. Read and search freely first so the plan is concrete.'
        : '\nMode: AUTO — you may write into the document. Read before you write.',
  );

  parts.push(
    input.documentTitle
      ? `\nOpen document: ${input.documentTitle}`
      : '\nNo document is currently open in the Canvas — create_chapter can start a new one.',
  );

  return parts.join('\n');
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

  const recent = (input.recentWork ?? '').trim();
  if (recent) parts.push(`\n${recent.slice(0, 2000)}`);

  // Author voice sits before قواعد.md — style guidance the rules can still override.
  const voice = authorVoicePromptSection(input.authorVoice);
  if (voice) parts.push(`\n${voice}`);

  const rules = (input.projectRules ?? '').trim();
  if (rules) {
    parts.push(
      `\n── Project rules (قواعد.md) — these always hold, the scholar wrote them ──\n${rules.slice(0, 4000)}`,
    );
  }

  return parts.join('\n');
}
