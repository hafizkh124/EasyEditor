/**
 * M8 Layer 6 — Word global-option consent + revert log (SPEC-M8 §3 gate #5).
 *
 * `Application.Options` changes affect EVERY document the scholar opens, so the
 * agent never applies one directly: `set_global_option` returns a consent
 * request, the scholar approves it in the Agent panel, and this module applies
 * it AND appends a line to `.easyeditor/history/global-options.jsonl` recording
 * the previous value — so `revertGlobalOptions` can put every change back.
 */
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../lib/logger.js';
import { EASYEDITOR_DIR } from '../../shared/fs/projectTypes.js';
import { getWordOption, setWordOption, ALLOWED_GLOBAL_OPTIONS, type GlobalOptionKey } from '../adapters/word.js';

const log = logger.child('agent/globalOptions');

const LOG_FILE = 'global-options.jsonl';

function logPath(root: string): string {
  return path.join(root, EASYEDITOR_DIR, 'history', LOG_FILE);
}

export interface GlobalOptionLogEntry {
  at: string;
  action: 'apply' | 'revert';
  option: GlobalOptionKey;
  /** The value before this change — what `revert` restores. */
  previous: string;
  /** The value this change set. */
  applied: string;
}

export function isAllowedOption(option: string): option is GlobalOptionKey {
  return option in ALLOWED_GLOBAL_OPTIONS;
}

function append(root: string, entry: GlobalOptionLogEntry): void {
  const p = logPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(entry) + '\n', 'utf8');
}

export function readLog(root: string): GlobalOptionLogEntry[] {
  try {
    return fs.readFileSync(logPath(root), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as GlobalOptionLogEntry);
  } catch {
    return [];
  }
}

/**
 * Apply a consented global-option change and record the previous value. The
 * allow-list is enforced here as well as in wordBridge.ps1 and the tool schema.
 */
export async function applyGlobalOption(
  root: string,
  option: string,
  value: string,
): Promise<{ option: string; previous: string; applied: string }> {
  if (!isAllowedOption(option)) throw new Error(`option not allowed: ${option}`);
  const next = value === 'true' ? 'true' : 'false';
  const previous = await getWordOption(option);
  const applied = await setWordOption(option, next);
  append(root, { at: new Date().toISOString(), action: 'apply', option, previous, applied });
  log.info('applied global option', { option, previous, applied });
  return { option, previous, applied };
}

/**
 * Put every applied global-option change back to the value it had before the
 * agent touched it — walking the log newest-first so the earliest `previous`
 * wins. Records the reverts too, so the log stays a full history.
 */
export async function revertGlobalOptions(
  root: string,
): Promise<{ reverted: Array<{ option: string; to: string }> }> {
  const entries = readLog(root).filter((e) => e.action === 'apply');
  // Earliest recorded `previous` per option is the true pre-agent state.
  const target = new Map<GlobalOptionKey, string>();
  for (const e of entries) if (!target.has(e.option)) target.set(e.option, e.previous);

  const reverted: Array<{ option: string; to: string }> = [];
  for (const [option, to] of target) {
    const current = await getWordOption(option);
    if (current === to) continue;
    await setWordOption(option, to === 'true' ? 'true' : 'false');
    append(root, { at: new Date().toISOString(), action: 'revert', option, previous: current, applied: to });
    reverted.push({ option, to });
  }
  log.info('reverted global options', { count: reverted.length });
  return { reverted };
}
