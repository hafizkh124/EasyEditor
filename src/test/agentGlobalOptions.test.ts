// @vitest-environment node
// electron/agent/globalOptions.ts — the consent + revert log for Word
// Application options (SPEC-M8 §3 gate #5). What must hold: an applied change
// records the PREVIOUS value, and revert puts every touched option back to the
// value it had before the agent — even after several applies.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let optionValue: Record<string, string> = {};
const getWordOption = vi.fn(async (k: string) => optionValue[k] ?? 'true');
const setWordOption = vi.fn(async (k: string, v: string) => { optionValue[k] = v; return v; });
vi.mock('../../electron/adapters/word.ts', () => ({
  getWordOption,
  setWordOption,
  ALLOWED_GLOBAL_OPTIONS: { check_spelling: 'CheckSpellingAsYouType', check_grammar: 'CheckGrammarAsYouType', smart_quotes: 'AutoFormatAsYouTypeReplaceQuotes' },
}));

let mod: typeof import('../../electron/agent/globalOptions.ts');
let root: string;

beforeEach(async () => {
  vi.clearAllMocks();
  optionValue = { check_spelling: 'true', check_grammar: 'true', smart_quotes: 'true' };
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'globalopts-'));
  fs.mkdirSync(path.join(root, '.easyeditor', 'history'), { recursive: true });
  mod = await import('../../electron/agent/globalOptions.ts');
});

const logLines = () =>
  fs.readFileSync(path.join(root, '.easyeditor', 'history', 'global-options.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('applyGlobalOption', () => {
  it('applies the change and records the previous value', async () => {
    const r = await mod.applyGlobalOption(root, 'check_spelling', 'false');
    expect(r).toEqual({ option: 'check_spelling', previous: 'true', applied: 'false' });
    expect(setWordOption).toHaveBeenCalledWith('check_spelling', 'false');
    expect(logLines()).toEqual([expect.objectContaining({ action: 'apply', option: 'check_spelling', previous: 'true', applied: 'false' })]);
  });

  it('refuses an option outside the allow-list', async () => {
    await expect(mod.applyGlobalOption(root, 'RunMacros', 'true')).rejects.toThrow(/not allowed/);
  });
});

describe('revertGlobalOptions', () => {
  it('restores every touched option to its pre-agent value, ignoring the noise in between', async () => {
    await mod.applyGlobalOption(root, 'check_spelling', 'false');
    await mod.applyGlobalOption(root, 'check_spelling', 'true');   // agent flip-flopped
    await mod.applyGlobalOption(root, 'smart_quotes', 'false');
    expect(optionValue).toMatchObject({ check_spelling: 'true', smart_quotes: 'false' });

    const r = await mod.revertGlobalOptions(root);
    // check_spelling's pre-agent value was 'true' and it's already there → not re-set;
    // smart_quotes goes back to 'true'.
    expect(r.reverted).toEqual([{ option: 'smart_quotes', to: 'true' }]);
    expect(optionValue).toMatchObject({ check_spelling: 'true', smart_quotes: 'true' });
    expect(logLines().some((l) => l.action === 'revert' && l.option === 'smart_quotes')).toBe(true);
  });

  it('is a no-op with nothing in the log', async () => {
    const r = await mod.revertGlobalOptions(root);
    expect(r.reverted).toEqual([]);
  });
});
