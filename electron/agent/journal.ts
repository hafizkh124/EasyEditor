/**
 * M9 Phase E — the per-project agent journal.
 *
 * `agent.run()` is memory-less: every task starts cold. For a book that takes
 * many sessions this loses the thread — the scholar re-explains what was done
 * last time. The journal is a short, append-only log under
 * `.easyeditor/journal.jsonl` (next to `.easyeditor/history/`); `run.ts` writes
 * one line per finished task and folds a summary of the last few into the
 * system prompt as CONTEXT (not instructions).
 *
 * It is derived, disposable state — deleting the file just loses continuity.
 */
import path from 'node:path';
import fs from 'node:fs';
import { EASYEDITOR_DIR } from '../../shared/fs/projectTypes.js';
import { logger } from '../lib/logger.js';
import type { AgentRunResult } from '../../shared/agent/types.js';

const log = logger.child('agent/journal');

const JOURNAL_FILE = 'journal.jsonl';
const MAX_LINES = 300;
const SUMMARY_ENTRIES = 8;

export interface JournalEntry {
  ts: string;
  instruction: string;
  mode: string;
  provider: string;
  stopReason: string;
  steps: number;
  /** Chapter files a write tool actually changed. */
  wrote: string[];
  /** A few source references retrieved this task. */
  sources: string[];
  /** The task's own answer, trimmed. */
  summary: string;
}

function journalPath(root: string): string {
  return path.join(root, EASYEDITOR_DIR, JOURNAL_FILE);
}

const WRITE_TOOLS = new Set([
  'insert_footnote', 'set_page_layout', 'run_task', 'draft_section', 'add_document_comment',
  'create_chapter', 'build_scholarly_indexes', 'typeset_print_ready', 'transcribe_media', 'ocr_document',
  'automate_word_document',
]);

const isErr = (r: unknown): boolean =>
  typeof r === 'object' && r !== null && ('error' in r || 'needsConsent' in r);

/** Pull the chapters written and the sources seen out of a finished run. */
export function digestRun(result: AgentRunResult): { wrote: string[]; sources: string[] } {
  const wrote = new Set<string>();
  const sources = new Set<string>();
  for (const c of result.toolCalls) {
    if (WRITE_TOOLS.has(c.name) && !isErr(c.result)) {
      const ch = (c.args as { chapter?: unknown }).chapter;
      if (typeof ch === 'string') wrote.add(ch);
    }
    const res = c.result as { results?: Array<{ reference?: unknown }> } | undefined;
    if (Array.isArray(res?.results)) {
      for (const r of res!.results) if (typeof r.reference === 'string') sources.add(r.reference);
    }
  }
  return { wrote: [...wrote], sources: [...sources].slice(0, 12) };
}

export function appendJournalEntry(root: string, entry: JournalEntry): void {
  try {
    const p = journalPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let lines: string[] = [];
    try { lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { /* new file */ }
    lines.push(JSON.stringify(entry));
    fs.writeFileSync(p, `${lines.slice(-MAX_LINES).join('\n')}\n`, 'utf8');
  } catch (err) {
    log.warn('could not write the journal', { message: (err as Error).message });
  }
}

export function readRecentJournal(root: string, n = SUMMARY_ENTRIES): JournalEntry[] {
  let lines: string[];
  try {
    lines = fs.readFileSync(journalPath(root), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const out: JournalEntry[] = [];
  for (const l of lines.slice(-n * 2)) {
    try {
      const e = JSON.parse(l) as JournalEntry;
      if (e && typeof e.ts === 'string' && typeof e.instruction === 'string') out.push(e);
    } catch { /* skip a corrupt line */ }
  }
  return out.slice(-n);
}

/** A compact digest for the system prompt, or null when there is no history. */
export function formatJournalForPrompt(entries: JournalEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines = entries.map((e) => {
    const when = e.ts.slice(0, 16).replace('T', ' ');
    const bits: string[] = [`[${when}] "${e.instruction.slice(0, 90)}"`];
    if (e.wrote.length) bits.push(`edited ${e.wrote.join(', ')}`);
    if (e.stopReason !== 'done') bits.push(`(${e.stopReason})`);
    let line = `- ${bits.join(' — ')}`;
    // M11 Phase 1 — `summary` and `sources` were written to every journal
    // entry but never rendered into the prompt. That is real, already-captured
    // context (what the task concluded, what it cited) being dropped.
    const summary = e.summary?.replace(/\s+/g, ' ').trim();
    if (summary) line += `\n  ↳ ${summary.slice(0, 220)}`;
    if (e.sources?.length) line += `\n  ↳ sources: ${e.sources.slice(0, 4).join(' · ')}`;
    return line;
  });
  return (
    '── Recent agent work on this project (context only — it may be stale; verify with a tool before relying on it) ──\n' +
    lines.join('\n')
  );
}
