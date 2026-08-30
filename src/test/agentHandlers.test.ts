// @vitest-environment node
// electron/ipc/agentHandlers.ts — AGENT_INVOKE's action switch (SPEC-M8
// Layer 6). runAgent is mocked; this covers the IPC seam: the channel is
// registered, `run` forwards the instruction/mode/root and records a
// task_run, `cancel`/`status` reach the queue, and a second `run` while one
// is in flight is REFUSED (ADR-0019 item 6 — one agent task at a time).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createElectronMock } from './helpers/electronMock';
import { isAllowedIpcChannel, ALLOWED_IPC_CHANNELS } from '../../electron/ipc/registry';

const electron = createElectronMock();
vi.mock('electron', () => electron);

let resolveRun: (v: unknown) => void = () => {};
const runAgent = vi.fn(() => new Promise((res) => { resolveRun = res; }));
vi.mock('../../electron/agent/run.ts', () => ({ runAgent }));

const undoCheckpoint = vi.fn(() => ({ restored: ['01.docx'], removed: [] }));
const listCheckpoints = vi.fn(() => [{ id: 'cp_1', createdAt: 'x', label: 't', files: ['01.docx'] }]);
vi.mock('../../electron/agent/checkpoint.ts', () => ({ undoCheckpoint, listCheckpoints }));

const applyGlobalOption = vi.fn(async () => ({ option: 'check_spelling', previous: 'true', applied: 'false' }));
const revertGlobalOptions = vi.fn(async () => ({ reverted: [{ option: 'check_spelling', to: 'true' }] }));
const readGlobalOptionLog = vi.fn(() => [{ at: 'x', action: 'apply', option: 'check_spelling', previous: 'true', applied: 'false' }]);
vi.mock('../../electron/agent/globalOptions.ts', () => ({
  applyGlobalOption, revertGlobalOptions, readLog: readGlobalOptionLog,
}));

const requestGeneralSearch = vi.fn(async () => ({ answer: 'x', channel: 'general' }));
const resolveGeneralSearch = vi.fn();
vi.mock('../../electron/agent/generalSearch.ts', () => ({ requestGeneralSearch, resolveGeneralSearch }));

const createTaskRun = vi.fn(async () => ({ id: 'trun_1' }));
const updateTaskRunStatus = vi.fn(async () => ({}));
vi.mock('../../electron/ipc/workspaceHandlers.ts', () => ({
  getWorkspaceDbService: vi.fn(async () => ({ createTaskRun, updateTaskRunStatus })),
}));

let mod: typeof import('../../electron/ipc/agentHandlers.ts');

beforeAll(async () => {
  mod = await import('../../electron/ipc/agentHandlers.ts');
  mod.registerAgentHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  runAgent.mockImplementation(() => new Promise((res) => { resolveRun = res; }));
});

const invoke = (p: Record<string, unknown>) => electron.invoke('agent:invoke', p);

describe('registry', () => {
  it('registers AGENT_INVOKE and AGENT_PROGRESS', () => {
    expect(ALLOWED_IPC_CHANNELS.AGENT_INVOKE).toBe('agent:invoke');
    expect(isAllowedIpcChannel('agent:invoke')).toBe(true);
    expect(isAllowedIpcChannel('agent:do-anything')).toBe(false);
  });
});

describe('run', () => {
  it('forwards instruction/mode/root to runAgent and records a task_run', async () => {
    const p = invoke({ action: 'run', instruction: 'tidy chapter 1', mode: 'do', projectRoot: 'C:\\p' });
    // let the microtask that creates the run + calls runAgent settle
    await new Promise((r) => setTimeout(r, 0));
    expect(createTaskRun).toHaveBeenCalledWith(expect.objectContaining({ task_slug: 'agent' }));
    expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ instruction: 'tidy chapter 1', mode: 'do', projectRoot: 'C:\\p' }));

    resolveRun({ answer: 'done', stopReason: 'done', steps: 2, toolCalls: [], playbook: undefined });
    const res = await p as { answer: string; stopReason: string };
    expect(res).toMatchObject({ answer: 'done', stopReason: 'done' });
    expect(updateTaskRunStatus).toHaveBeenCalledWith('trun_1', 'completed', expect.any(Object), undefined);
  });

  it('refuses a second run while one is in flight (one agent task at a time)', async () => {
    const first = invoke({ action: 'run', instruction: 'a', mode: 'ask', projectRoot: 'C:\\p' });
    await new Promise((r) => setTimeout(r, 0));

    await expect(invoke({ action: 'run', instruction: 'b', mode: 'ask', projectRoot: 'C:\\p' }))
      .rejects.toThrow(/پہلے سے چل رہا|already/i);

    resolveRun({ answer: '', stopReason: 'done', steps: 1, toolCalls: [] });
    await first;
  });

  it('rejects an empty instruction or missing project folder', async () => {
    await expect(invoke({ action: 'run', instruction: '  ', mode: 'ask', projectRoot: 'C:\\p' })).rejects.toThrow(/instruction/);
    await expect(invoke({ action: 'run', instruction: 'x', mode: 'ask', projectRoot: '' })).rejects.toThrow(/project folder/);
  });
});

describe('status / cancel', () => {
  it('status reports idle when nothing is running', async () => {
    await expect(invoke({ action: 'status' })).resolves.toEqual({ busy: false, running: null });
  });

  it('cancel returns false when nothing is running', async () => {
    await expect(invoke({ action: 'cancel' })).resolves.toEqual({ cancelled: false });
  });

  it('an unknown action throws, naming it', async () => {
    await expect(invoke({ action: 'yolo' })).rejects.toThrow(/yolo/);
  });
});

describe('undoTask', () => {
  it('reverts the checkpoint and reports what was restored', async () => {
    await expect(invoke({ action: 'undoTask', projectRoot: 'C:\\p', checkpointId: 'cp_1' }))
      .resolves.toEqual({ restored: ['01.docx'], removed: [] });
    expect(undoCheckpoint).toHaveBeenCalledWith('C:\\p', 'cp_1');
  });

  it('requires both projectRoot and checkpointId', async () => {
    await expect(invoke({ action: 'undoTask', projectRoot: '', checkpointId: 'cp_1' })).rejects.toThrow(/required/);
  });

  it('checkpoints lists them', async () => {
    await expect(invoke({ action: 'checkpoints', projectRoot: 'C:\\p' })).resolves.toEqual({ checkpoints: expect.any(Array) });
  });
});

describe('global options (P9, §3 gate #5)', () => {
  it('applyGlobalOption forwards root/option/value', async () => {
    await expect(invoke({ action: 'applyGlobalOption', projectRoot: 'C:\\p', option: 'check_spelling', value: 'false' }))
      .resolves.toMatchObject({ option: 'check_spelling', previous: 'true' });
    expect(applyGlobalOption).toHaveBeenCalledWith('C:\\p', 'check_spelling', 'false');
  });

  it('revertGlobalOptions and globalOptionLog reach the module', async () => {
    await expect(invoke({ action: 'revertGlobalOptions', projectRoot: 'C:\\p' })).resolves.toMatchObject({ reverted: expect.any(Array) });
    await expect(invoke({ action: 'globalOptionLog', projectRoot: 'C:\\p' })).resolves.toEqual({ entries: expect.any(Array) });
  });

  it('applyGlobalOption requires a project folder', async () => {
    await expect(invoke({ action: 'applyGlobalOption', projectRoot: '', option: 'check_spelling', value: 'false' })).rejects.toThrow(/projectRoot/);
  });
});

describe('generalSearchResult (renderer → main bridge, ADR-0019 #7)', () => {
  it('forwards the renderer\'s answer to the pending request', async () => {
    await expect(invoke({ action: 'generalSearchResult', requestId: 'req_1', answer: 'the answer', channel: 'general' }))
      .resolves.toEqual({ ok: true });
    expect(resolveGeneralSearch).toHaveBeenCalledWith('req_1', expect.objectContaining({ answer: 'the answer', channel: 'general' }));
  });

  it('forwards an error the same way', async () => {
    await invoke({ action: 'generalSearchResult', requestId: 'req_2', error: 'offline' });
    expect(resolveGeneralSearch).toHaveBeenCalledWith('req_2', expect.objectContaining({ error: 'offline' }));
  });
});
