/**
 * M9 (blueprint §3, optional) — the per-project AI-assistance disclosure ledger.
 *
 * `run.ts` calls `digestDisclosure` on every finished run and appends one line
 * per AI drafting / rewriting write to `.easyeditor/ai-disclosure.jsonl`. The
 * `compile_ai_disclosure` tool reads it back and `buildDisclosureStatement`
 * (shared/agent/disclosure.ts) turns it into a front-matter statement.
 *
 * Derived, disposable state — deleting the file just forgets the history.
 */
import path from 'node:path';
import fs from 'node:fs';
import { EASYEDITOR_DIR } from '../../shared/fs/projectTypes.js';
import { AI_DISCLOSURE_LEDGER, DISCLOSED_TASKS, type DisclosureEntry } from '../../shared/agent/disclosure.js';
import { logger } from '../lib/logger.js';
import type { AgentRunResult } from '../../shared/agent/types.js';

const log = logger.child('agent/disclosure');

const MAX_LINES = 500;

function ledgerPath(root: string): string {
  return path.join(root, EASYEDITOR_DIR, AI_DISCLOSURE_LEDGER);
}

const isErr = (r: unknown): boolean =>
  typeof r === 'object' && r !== null && ('error' in r || 'needsConsent' in r);

const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/**
 * Pull the AI drafting / rewriting acts out of a finished run. `provider` and
 * `model` are the TEXT provider (the one that generated the prose), resolved by
 * run.ts.
 */
export function digestDisclosure(
  result: AgentRunResult,
  provider: string,
  model: string,
  when = new Date().toISOString(),
): DisclosureEntry[] {
  const out: DisclosureEntry[] = [];
  for (const c of result.toolCalls) {
    if (isErr(c.result)) continue;
    const res = (c.result ?? {}) as Record<string, unknown>;
    const args = (c.args ?? {}) as Record<string, unknown>;

    if (c.name === 'draft_section') {
      const kind = asStr(res.mode) ?? asStr(args.mode);
      const chapter = asStr(res.chapter) ?? asStr(args.chapter);
      if (!kind || !chapter) continue;
      out.push({
        ts: when, chapter, tool: 'draft_section', kind, provider, model,
        ...(typeof res.sourcesUsed === 'number' ? { sources: res.sourcesUsed } : {}),
      });
    } else if (c.name === 'run_task') {
      const kind = asStr(res.task) ?? asStr(args.task);
      const chapter = asStr(res.chapter) ?? asStr(args.chapter);
      if (!kind || !chapter || !DISCLOSED_TASKS.has(kind)) continue;
      out.push({ ts: when, chapter, tool: 'run_task', kind, provider, model });
    }
  }
  return out;
}

export function appendDisclosureEntries(root: string, entries: DisclosureEntry[]): void {
  if (entries.length === 0) return;
  try {
    const p = ledgerPath(root);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let lines: string[] = [];
    try { lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean); } catch { /* new file */ }
    for (const e of entries) lines.push(JSON.stringify(e));
    fs.writeFileSync(p, `${lines.slice(-MAX_LINES).join('\n')}\n`, 'utf8');
  } catch (err) {
    log.warn('could not write the AI-disclosure ledger', { message: (err as Error).message });
  }
}

export function readDisclosureEntries(root: string): DisclosureEntry[] {
  let lines: string[];
  try {
    lines = fs.readFileSync(ledgerPath(root), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  const out: DisclosureEntry[] = [];
  for (const l of lines) {
    try {
      const e = JSON.parse(l) as DisclosureEntry;
      if (e && typeof e.ts === 'string' && typeof e.chapter === 'string' && (e.tool === 'draft_section' || e.tool === 'run_task')) {
        out.push(e);
      }
    } catch { /* skip a corrupt line */ }
  }
  return out;
}
