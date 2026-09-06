// @vitest-environment node
// electron/agent/journal.ts (M9 Phase E) — the per-project agent journal that
// gives cross-session continuity. What must hold: one line per finished task,
// the file is bounded, the digest pulls out chapters written + sources seen,
// and the prompt section is framed as stale-able context.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendJournalEntry, readRecentJournal, formatJournalForPrompt, digestRun,
  type JournalEntry,
} from '../../electron/agent/journal';
import type { AgentRunResult } from '../../shared/agent/types';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  ts: new Date().toISOString(), instruction: 'add citations', mode: 'auto', provider: 'gemini',
  stopReason: 'done', steps: 4, wrote: [], sources: [], summary: 'done', ...over,
});

describe('journal file', () => {
  it('appends one JSONL line per entry, newest last', () => {
    appendJournalEntry(root, entry({ instruction: 'first' }));
    appendJournalEntry(root, entry({ instruction: 'second' }));
    const recent = readRecentJournal(root);
    expect(recent.map((e) => e.instruction)).toEqual(['first', 'second']);
    expect(fs.existsSync(path.join(root, '.easyeditor', 'journal.jsonl'))).toBe(true);
  });

  it('caps the file at 300 lines', () => {
    // Pre-seed 299 lines in one write, then let append() do the capping.
    fs.mkdirSync(path.join(root, '.easyeditor'), { recursive: true });
    const seed = Array.from({ length: 299 }, (_v, i) => JSON.stringify(entry({ instruction: `t${i}` }))).join('\n');
    fs.writeFileSync(path.join(root, '.easyeditor', 'journal.jsonl'), seed + '\n');
    appendJournalEntry(root, entry({ instruction: 'new-1' }));
    appendJournalEntry(root, entry({ instruction: 'new-2' }));
    const lines = fs.readFileSync(path.join(root, '.easyeditor', 'journal.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBe(300);
    expect(JSON.parse(lines[0]).instruction).toBe('t1'); // oldest 1 dropped
    expect(JSON.parse(lines[299]).instruction).toBe('new-2');
  });

  it('readRecentJournal returns [] for a project with no journal and survives a corrupt line', () => {
    expect(readRecentJournal(root)).toEqual([]);
    fs.mkdirSync(path.join(root, '.easyeditor'), { recursive: true });
    fs.writeFileSync(path.join(root, '.easyeditor', 'journal.jsonl'), 'not json\n' + JSON.stringify(entry({ instruction: 'ok' })) + '\n');
    expect(readRecentJournal(root).map((e) => e.instruction)).toEqual(['ok']);
  });
});

describe('digestRun', () => {
  const result = (toolCalls: AgentRunResult['toolCalls']): AgentRunResult => ({
    answer: '', messages: [], toolCalls, steps: toolCalls.length, stopReason: 'done',
  });

  it('collects chapters that a write tool actually changed', () => {
    const d = digestRun(result([
      { name: 'insert_footnote', args: { chapter: '02-body.docx' }, result: { applied: 1 } },
      { name: 'run_task', args: { chapter: '02-body.docx' }, result: { revisions: 3 } },
      { name: 'set_page_layout', args: { chapter: '03.docx' }, result: { error: 'x' } }, // errored — not counted
    ]));
    expect(d.wrote).toEqual(['02-body.docx']);
  });

  it('collects source references from search results', () => {
    const d = digestRun(result([
      { name: 'search_shamela', args: { query: 'x' }, result: { results: [{ id: 's1', reference: 'صحيح البخاري، ص 40' }, { id: 's2', reference: 'موطأ مالك' }] } },
    ]));
    expect(d.sources).toEqual(['صحيح البخاري، ص 40', 'موطأ مالك']);
  });
});

describe('formatJournalForPrompt', () => {
  it('is null with no history', () => {
    expect(formatJournalForPrompt([])).toBeNull();
  });

  it('renders a compact digest and flags it as stale-able context', () => {
    const s = formatJournalForPrompt([
      entry({ instruction: 'add citations to chapter 2', wrote: ['02-body.docx'] }),
      entry({ instruction: 'draft the intro', wrote: [], stopReason: 'needs-input' }),
    ])!;
    expect(s).toMatch(/context only.*stale/i);
    expect(s).toContain('add citations to chapter 2');
    expect(s).toContain('edited 02-body.docx');
    expect(s).toContain('(needs-input)');
  });
});
