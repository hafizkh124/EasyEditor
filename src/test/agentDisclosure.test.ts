// @vitest-environment node
// The AI-assistance disclosure ledger (blueprint §3, optional).
//   - shared/agent/disclosure.ts — buildDisclosureStatement is pure and
//     deterministic (no model call); it groups by chapter and separates
//     drafting from rewriting.
//   - electron/agent/disclosure.ts — digestDisclosure pulls the drafting /
//     substantive-rewriting writes out of a finished run; the ledger file is
//     append-only, bounded, and survives a corrupt line.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildDisclosureStatement, modelsUsed, DISCLOSED_TASKS,
  type DisclosureEntry,
} from '../../shared/agent/disclosure';
import {
  digestDisclosure, appendDisclosureEntries, readDisclosureEntries,
} from '../../electron/agent/disclosure';
import type { AgentRunResult } from '../../shared/agent/types';

const entry = (over: Partial<DisclosureEntry> = {}): DisclosureEntry => ({
  ts: '2026-09-01T10:00:00.000Z', chapter: '02-body.docx', tool: 'run_task',
  kind: 'paraphrase', provider: 'gemini', model: 'gemini-2.5-flash', ...over,
});

describe('buildDisclosureStatement', () => {
  it('separates AI drafting from AI rewriting, grouped by chapter', () => {
    const s = buildDisclosureStatement([
      entry({ chapter: '04-fasl.docx', tool: 'draft_section', kind: 'prose', sources: 3 }),
      entry({ chapter: '04-fasl.docx', tool: 'draft_section', kind: 'summary' }),
      entry({ chapter: '02-body.docx', tool: 'run_task', kind: 'formalize' }),
      entry({ chapter: '02-body.docx', tool: 'run_task', kind: 'paraphrase' }),
    ]);
    expect(s).toContain('## نئی تحریر کا مسودہ (AI drafting)');
    expect(s).toContain('**04-fasl.docx** — prose، summary');
    expect(s).toContain('## موجودہ متن کی اصلاح و تلخیص (AI rewriting)');
    expect(s).toContain('**02-body.docx** — formalize، paraphrase');
    // and the English half
    expect(s).toContain('**AI drafting:**');
    expect(s).toContain('- 04-fasl.docx (prose, summary)');
    expect(s).toContain('**AI rewriting:**');
  });

  it('lists each distinct provider/model and the date range', () => {
    const s = buildDisclosureStatement([
      entry({ ts: '2026-08-30T09:00:00Z' }),
      entry({ ts: '2026-09-06T12:00:00Z', provider: 'groq', model: 'openai/gpt-oss-20b' }),
    ]);
    expect(s).toContain('Google Gemini (gemini-2.5-flash)');
    expect(s).toContain('Groq (openai/gpt-oss-20b)');
    expect(s).toContain('2026-08-30 – 2026-09-06');
  });

  it('uses the book title when given, and a single date when there is only one', () => {
    const s = buildDisclosureStatement([entry({ ts: '2026-09-01T00:00:00Z' })], { projectTitle: 'مقدمة في الأصول' });
    expect(s).toContain('«مقدمة في الأصول»');
    expect(s).toContain('"مقدمة في الأصول"');
    expect(s).toContain('**مدت:** 2026-09-01');
    expect(s).not.toContain('–');
  });

  it('says it is a factual record, not policy advice', () => {
    expect(buildDisclosureStatement([entry()])).toMatch(/not\s+legal or journal-policy advice/i);
  });

  it('modelsUsed de-dupes and sorts', () => {
    expect(modelsUsed([entry(), entry(), entry({ provider: 'groq', model: 'x' })])).toEqual([
      'Google Gemini (gemini-2.5-flash)', 'Groq (x)',
    ]);
  });
});

describe('digestDisclosure', () => {
  const result = (toolCalls: AgentRunResult['toolCalls']): AgentRunResult => ({
    answer: '', messages: [], toolCalls, steps: toolCalls.length, stopReason: 'done',
  });

  it('records draft_section (with source count) and substantive run_task, skipping mechanical passes and errors', () => {
    const d = digestDisclosure(result([
      { name: 'draft_section', args: { chapter: '04.docx', mode: 'prose' }, result: { chapter: '04.docx', mode: 'prose', sourcesUsed: 2, revisions: 5 } },
      { name: 'run_task', args: { chapter: '02.docx', task: 'formalize' }, result: { chapter: '02.docx', task: 'formalize', changed: true } },
      { name: 'run_task', args: { chapter: '02.docx', task: 'add_harakat' }, result: { chapter: '02.docx', task: 'add_harakat', changed: true } }, // mechanical — not disclosed
      { name: 'run_task', args: { chapter: '03.docx', task: 'paraphrase' }, result: { error: 'no text' } }, // errored — not recorded
      { name: 'insert_footnote', args: { chapter: '02.docx' }, result: { applied: 1 } }, // not a drafting/rewriting tool
    ]), 'gemini', 'gemini-2.5-flash', '2026-09-06T00:00:00Z');

    expect(d).toEqual([
      { ts: '2026-09-06T00:00:00Z', chapter: '04.docx', tool: 'draft_section', kind: 'prose', provider: 'gemini', model: 'gemini-2.5-flash', sources: 2 },
      { ts: '2026-09-06T00:00:00Z', chapter: '02.docx', tool: 'run_task', kind: 'formalize', provider: 'gemini', model: 'gemini-2.5-flash' },
    ]);
  });

  it('DISCLOSED_TASKS is the substantive-rewrite set, not the mechanical one', () => {
    expect(DISCLOSED_TASKS.has('paraphrase')).toBe(true);
    expect(DISCLOSED_TASKS.has('summarize')).toBe(true);
    expect(DISCLOSED_TASKS.has('add_harakat')).toBe(false);
    expect(DISCLOSED_TASKS.has('spelling_check')).toBe(false);
  });
});

describe('the ledger file', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'disclosure-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('appends JSONL under .easyeditor/, reads back in order, and survives a corrupt line', () => {
    appendDisclosureEntries(root, [entry({ chapter: 'a.docx' })]);
    appendDisclosureEntries(root, [entry({ chapter: 'b.docx' }), entry({ chapter: 'c.docx' })]);
    expect(fs.existsSync(path.join(root, '.easyeditor', 'ai-disclosure.jsonl'))).toBe(true);
    expect(readDisclosureEntries(root).map((e) => e.chapter)).toEqual(['a.docx', 'b.docx', 'c.docx']);

    fs.appendFileSync(path.join(root, '.easyeditor', 'ai-disclosure.jsonl'), 'not json\n');
    expect(readDisclosureEntries(root).map((e) => e.chapter)).toEqual(['a.docx', 'b.docx', 'c.docx']);
  });

  it('is a no-op for an empty entry list and returns [] for a project with no ledger', () => {
    appendDisclosureEntries(root, []);
    expect(fs.existsSync(path.join(root, '.easyeditor', 'ai-disclosure.jsonl'))).toBe(false);
    expect(readDisclosureEntries(root)).toEqual([]);
  });

  it('caps the file at 500 lines', () => {
    fs.mkdirSync(path.join(root, '.easyeditor'), { recursive: true });
    const seed = Array.from({ length: 499 }, (_v, i) => JSON.stringify(entry({ chapter: `t${i}.docx` }))).join('\n');
    fs.writeFileSync(path.join(root, '.easyeditor', 'ai-disclosure.jsonl'), seed + '\n');
    appendDisclosureEntries(root, [entry({ chapter: 'new-1.docx' }), entry({ chapter: 'new-2.docx' })]);
    const lines = fs.readFileSync(path.join(root, '.easyeditor', 'ai-disclosure.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(lines.length).toBe(500);
    expect(JSON.parse(lines[499]).chapter).toBe('new-2.docx');
    expect(JSON.parse(lines[0]).chapter).toBe('t1.docx');
  });
});
