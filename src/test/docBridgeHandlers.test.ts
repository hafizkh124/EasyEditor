// @vitest-environment node
// electron/ipc/docBridgeHandlers.ts — DOC_BRIDGE_INVOKE's action switch
// (SPEC-M8 Layer 1 / P1). Only two actions in P1 (`detectTools`, `ping`),
// both thin forwards into electron/host/, so this covers: the channel is
// registered on the allowlist, each action forwards to the right host
// function, and an unknown action fails loudly naming itself (so a typo in
// the renderer is diagnosable). The host layer itself is exercised by
// hostPowershell.test.ts / hostProcess.test.ts.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createElectronMock } from './helpers/electronMock';
import { isAllowedIpcChannel, ALLOWED_IPC_CHANNELS } from '../../electron/ipc/registry';

const electron = createElectronMock();
vi.mock('electron', () => electron);

const hostMocks = {
  detectTools: vi.fn(() => ({
    powershell: true,
    word: true,
    wordVersion: '16.0',
    windows: true,
  })),
  pingHost: vi.fn(async () => ({ ok: true, latencyMs: 12 })),
};
vi.mock('../../electron/host/index.ts', () => hostMocks);

let mod: typeof import('../../electron/ipc/docBridgeHandlers.ts');

beforeAll(async () => {
  mod = await import('../../electron/ipc/docBridgeHandlers.ts');
  mod.registerDocBridgeHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

const invoke = (payload: Record<string, unknown>) => electron.invoke('docbridge:invoke', payload);

describe('registry', () => {
  it('registers DOC_BRIDGE_INVOKE and DOC_BRIDGE_PROGRESS on the allowlist', () => {
    expect(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE).toBe('docbridge:invoke');
    expect(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_PROGRESS).toBe('docbridge:progress');
    expect(isAllowedIpcChannel('docbridge:invoke')).toBe(true);
    expect(isAllowedIpcChannel('docbridge:progress')).toBe(true);
  });

  it('rejects an unregistered docbridge channel', () => {
    expect(isAllowedIpcChannel('docbridge:run-arbitrary')).toBe(false);
  });

  it('registers exactly the one invoke channel', () => {
    expect([...electron.ipcMain.handlers.keys()]).toEqual(['docbridge:invoke']);
  });
});

describe('action dispatch', () => {
  it('detectTools forwards to host.detectTools', async () => {
    await expect(invoke({ action: 'detectTools' })).resolves.toMatchObject({ word: true, wordVersion: '16.0' });
    expect(hostMocks.detectTools).toHaveBeenCalledTimes(1);
  });

  it('ping forwards to host.pingHost', async () => {
    await expect(invoke({ action: 'ping' })).resolves.toEqual({ ok: true, latencyMs: 12 });
    expect(hostMocks.pingHost).toHaveBeenCalledTimes(1);
  });

  it('an unknown action throws, naming it', async () => {
    await expect(invoke({ action: 'toWord' })).rejects.toThrow(/toWord/);
  });

  it('a missing action throws rather than silently resolving', async () => {
    await expect(invoke({})).rejects.toThrow();
  });
});
