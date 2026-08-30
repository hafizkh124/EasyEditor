/**
 * M8 Layer 6 — the CLOSED agent tool registry (SPEC-M8 §3, ADR-0016 control 1).
 *
 * This is the agent's entire vocabulary. It cannot call anything not listed
 * here, and every parameter travels as JSON data — never concatenated into a
 * command (security gate 1). "Ask" mode filters to `effect: 'read'` only.
 *
 * Deferred to a later P8 slice: `search_general` (needs the General-mode edge
 * function's provenance tagging — ADR-0019 item 7), `run_playbook` execution
 * wiring, `install_font` / `install_template` / global-settings commands.
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
