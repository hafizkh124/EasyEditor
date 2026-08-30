/**
 * M8 Layer 6 — the CLOSED agent tool registry (SPEC-M8 §3, ADR-0016 control 1).
 *
 * This is the agent's entire vocabulary. It cannot call anything not listed
 * here, and every parameter travels as JSON data — never concatenated into a
 * command (security gate 1). "Ask" mode filters to `effect: 'read'` only.
 *
 * Deferred to a later P8 slice: `run_playbook` execution wiring.
 */
import type { AgentTool } from './types.js';

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'list_capabilities',
    description: "What document tools are available on this machine (Word, LibreOffice, InPage) and their versions. Call this first if the user asks what's possible.",
    params: {},
    required: [],
    effect: 'read',
  },
  {
    name: 'read_document',
    description: 'Read a chapter file: its headings, footnotes, tracked-change count, word count, and reading order. Use before editing so you know the structure.',
    params: {
      chapter: { type: 'string', description: 'The chapter file name in the open project folder, e.g. "02-body.docx".' },
    },
    required: ['chapter'],
    effect: 'read',
  },
  {
    name: 'search_corpus',
    description: "Page/volume-precise retrieval from the user's personal corpus and the project's own chapters. Returns ranked chunks with citation refs. This is how you find a source to cite.",
    params: {
      query: { type: 'string', description: 'What to look for, in the source language (Arabic/Urdu/English).' },
      limit: { type: 'number', description: 'Max results (default 8).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'search_shamela',
    description: "Full-text search of the user's local Maktaba Shamela library (classical Arabic works). Returns book, page, and snippet.",
    params: {
      query: { type: 'string', description: 'Arabic search terms.' },
      limit: { type: 'number', description: 'Max results (default 8).' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'search_general',
    description: "Ask the General research channel a question (the same one the Research tab uses — a signed-in, provenance-tagged web+model search, NOT open browsing). Use only for background/context the personal corpus and Shamela cannot answer. Its result is NOT page-precise, so it can never be used as a footnote source. Needs an internet connection and a signed-in session.",
    params: {
      query: { type: 'string', description: 'The question, in the scholar\'s language.' },
    },
    required: ['query'],
    effect: 'read',
  },
  {
    name: 'insert_footnote',
    description: "Insert a real Word footnote at each [N] marker in a chapter, as a tracked change. The footnote text MUST come from a chunk returned by search_corpus/search_shamela — you pass the marker and the source's id, not a reference you typed. Fails if the citation does not resolve to a retrieved chunk, or if `claim` is given and the source does not actually support it.",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      marker: { type: 'string', description: 'The literal marker in the text, e.g. "[1]".' },
      source_id: { type: 'string', description: 'The id of a chunk returned by a prior search_* call in this task.' },
      claim: { type: 'string', description: 'The exact sentence/claim this footnote supports. Strongly recommended — it is checked against the source excerpt before the footnote is inserted.' },
    },
    required: ['chapter', 'marker', 'source_id'],
    effect: 'write',
  },
  {
    name: 'set_page_layout',
    description: 'Apply the right-to-left page setup (margins + reading order) to a chapter, as a tracked change.',
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
    },
    required: ['chapter'],
    effect: 'write',
  },
  {
    name: 'convert_document',
    description: 'Convert a chapter to another format (pdf/rtf/txt) or reflow a PDF into an editable docx. Shows the user the loss list first. Does not need the agent — offered here for completeness.',
    params: {
      chapter: { type: 'string', description: 'The chapter file name (or a .pdf in the project folder for reflow).' },
      to: { type: 'string', description: 'Target format.', enum: ['docx', 'pdf', 'rtf', 'txt'] },
    },
    required: ['chapter', 'to'],
    effect: 'write',
  },
  {
    name: 'check_consistency',
    description: "After you change a term or citation in one chapter, search the project's OTHER chapters for the same term and report where it also appears — so you can suggest a review there. A lexical search, not an automatic edit.",
    params: {
      term: { type: 'string', description: 'The word or phrase to look for across the other chapters.' },
      exclude_chapter: { type: 'string', description: 'The chapter you just edited (skip it in the results).' },
    },
    required: ['term'],
    effect: 'read',
  },
  {
    name: 'run_task',
    description: "Run one of the 12 built-in text tasks (harakat, spelling, paraphrase, summarize, citations, auto-format, normalize, formalize, humanize, shorten, section summaries) on a chapter's text, as a tracked change.",
    params: {
      chapter: { type: 'string', description: 'The chapter file name.' },
      task: { type: 'string', description: 'The task slug.' },
    },
    required: ['chapter', 'task'],
    effect: 'write',
  },
  {
    name: 'install_font',
    description: "Install a font file the scholar has pointed you at, so it is usable in Word (e.g. a Nastaliq font for the thesis). The path must be a font file (.ttf/.otf/.ttc) that already exists on this machine — never a download URL. Verifies the font is visible to a running Word afterwards.",
    params: {
      font_path: { type: 'string', description: 'Absolute path to a .ttf/.otf/.ttc file already on disk (from an @mention or the scholar\'s message).' },
    },
    required: ['font_path'],
    effect: 'write',
  },
  {
    name: 'install_template',
    description: "Install a Word template (.dotx/.dotm) the scholar or their supervisor provided, and optionally attach it to a chapter (as a tracked change) so its styles apply. The path must be a template file already on disk.",
    params: {
      template_path: { type: 'string', description: 'Absolute path to a .dotx/.dotm file already on disk.' },
      chapter: { type: 'string', description: 'Optional — attach the template to this chapter and update its styles.' },
    },
    required: ['template_path'],
    effect: 'write',
  },
  {
    name: 'set_global_option',
    description: "Propose a change to a Word application setting that affects EVERY document the scholar opens (e.g. turning off as-you-type spell check). This does NOT apply the change — it returns a consent request the scholar must approve in the Agent panel, and every applied change is logged so it can be reverted. Allowed options: check_spelling, check_grammar, smart_quotes.",
    params: {
      option: { type: 'string', description: 'One of: check_spelling, check_grammar, smart_quotes.', enum: ['check_spelling', 'check_grammar', 'smart_quotes'] },
      value: { type: 'string', description: '"true" or "false".', enum: ['true', 'false'] },
    },
    required: ['option', 'value'],
    effect: 'write',
  },
];

export const READ_ONLY_TOOLS: AgentTool[] = AGENT_TOOLS.filter((t) => t.effect === 'read');

/** The tool set for a mode: "ask" is read-only, "do" is everything. */
export function toolsForMode(mode: 'ask' | 'do'): AgentTool[] {
  return mode === 'ask' ? READ_ONLY_TOOLS : AGENT_TOOLS;
}

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.name, t]));

export function getTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}
