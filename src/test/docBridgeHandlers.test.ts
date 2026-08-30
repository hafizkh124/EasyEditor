// @vitest-environment node
// electron/ipc/docBridgeHandlers.ts — DOC_BRIDGE_INVOKE's action switch
// (SPEC-M8 Layer 1–2 / P1–P2). Covers: the channel is on the allowlist,
// each action forwards to the right host/adapter function with the payload
// fields it expects, and an unknown/missing action fails loudly naming
// itself. Host and adapter internals are exercised by hostPowershell /
// hostProcess / wordAdapter tests.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createElectronMock } from './helpers/electronMock';
import { isAllowedIpcChannel, ALLOWED_IPC_CHANNELS } from '../../electron/ipc/registry';

const electron = createElectronMock();
// P3: the handler reaches for shell.openPath and a real save dialog.
(electron as unknown as { shell: Record<string, unknown> }).shell = { openPath: vi.fn(async () => '') };
electron.dialog.showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: 'C:\\Users\\me\\out.docx' }));
vi.mock('electron', () => electron);

const hostMocks = {
  detectTools: vi.fn(() => ({ powershell: true, word: true, wordVersion: '16.0', windows: true })),
  pingHost: vi.fn(async () => ({ ok: true, latencyMs: 12 })),
};
vi.mock('../../electron/host/index.ts', () => hostMocks);

const wordMocks = {
  wordDescriptor: {
    id: 'word', label: 'Microsoft Word', platforms: ['win32'],
    reads: [{ format: 'html', quality: 0.75 }, { format: 'pdf', quality: 0.5, lossy: 'layout lost' }],
    writes: [{ format: 'docx', quality: 1 }, { format: 'pdf', quality: 0.95 }, { format: 'txt', quality: 0.4, lossy: 'formatting dropped' }],
    ops: ['toWord', 'fromWord', 'reflowPdf', 'readStructure', 'installFont'],
  },
  available: vi.fn(() => ({ available: true, version: '16.0' })),
  toWord: vi.fn(async () => ({ outputPath: 'C:\\out.docx', ms: 5 })),
  fromWord: vi.fn(async () => ({ outputPath: 'C:\\out.pdf', ms: 5 })),
  reflowPdf: vi.fn(async () => ({ outputPath: 'C:\\out.docx', wordCount: 42, ms: 20 })),
  readStructure: vi.fn(async () => ({ headings: ['A'], footnotes: [], trackedChanges: 0, wordCount: 10, readingOrder: 'rtl' })),
  installFont: vi.fn(async () => ({ fontName: 'Jameel Noori Nastaleeq', verified: true })),
  exportDocument: vi.fn(async () => ({ outputPath: 'C:\\Users\\me\\out.docx', ms: 7 })),
};
vi.mock('../../electron/adapters/word.ts', () => wordMocks);

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

describe('P1 actions', () => {
  it('detectTools forwards to host.detectTools', async () => {
    await expect(invoke({ action: 'detectTools' })).resolves.toMatchObject({ word: true, wordVersion: '16.0' });
    expect(hostMocks.detectTools).toHaveBeenCalledTimes(1);
  });

  it('ping forwards to host.pingHost', async () => {
    await expect(invoke({ action: 'ping' })).resolves.toEqual({ ok: true, latencyMs: 12 });
    expect(hostMocks.pingHost).toHaveBeenCalledTimes(1);
  });
});

describe('P2 Word adapter actions', () => {
  it('word:descriptor returns the descriptor and current availability', async () => {
    await expect(invoke({ action: 'word:descriptor' })).resolves.toMatchObject({
      descriptor: { id: 'word' },
      availability: { available: true, version: '16.0' },
    });
  });

  it('word:toWord passes input / outputPath / options through', async () => {
    await invoke({ action: 'word:toWord', input: { html: '<p>x</p>' }, outputPath: 'C:\\a.docx', options: { rtlPageSetup: true } });
    expect(wordMocks.toWord).toHaveBeenCalledWith({ html: '<p>x</p>' }, 'C:\\a.docx', { rtlPageSetup: true });
  });

  it('word:fromWord passes sourcePath / to / outputPath through', async () => {
    await invoke({ action: 'word:fromWord', sourcePath: 'C:\\a.docx', to: 'pdf', outputPath: 'C:\\a.pdf' });
    expect(wordMocks.fromWord).toHaveBeenCalledWith('C:\\a.docx', 'pdf', 'C:\\a.pdf');
  });

  it('word:reflowPdf forwards paths and wires a progress callback', async () => {
    const send = vi.fn();
    const fn = electron.ipcMain.handlers.get('docbridge:invoke');
    await fn!(
      { sender: { send } },
      { action: 'word:reflowPdf', pdfPath: 'C:\\a.pdf', outputPath: 'C:\\a.docx' },
    );
    expect(wordMocks.reflowPdf).toHaveBeenCalledWith('C:\\a.pdf', 'C:\\a.docx', expect.any(Function));
  });

  it('word:readStructure forwards docxPath', async () => {
    await expect(invoke({ action: 'word:readStructure', docxPath: 'C:\\a.docx' })).resolves.toMatchObject({ readingOrder: 'rtl' });
    expect(wordMocks.readStructure).toHaveBeenCalledWith('C:\\a.docx');
  });

  it('word:installFont forwards fontPath', async () => {
    await expect(invoke({ action: 'word:installFont', fontPath: 'C:\\f.ttf' })).resolves.toMatchObject({ verified: true });
    expect(wordMocks.installFont).toHaveBeenCalledWith('C:\\f.ttf');
  });
});

describe('P3 convert dialog actions', () => {
  it('word:plan returns the route and loss list without running anything', async () => {
    const plan = await invoke({ action: 'word:plan', from: 'html', to: 'txt' });
    expect(plan).toMatchObject({ ok: true, losses: ['formatting dropped'] });
    expect(wordMocks.exportDocument).not.toHaveBeenCalled();
  });

  it('word:export shows a save dialog, then converts, and returns the path + losses', async () => {
    const res = await invoke({ action: 'word:export', html: '<p>x</p>', title: 'My Doc', to: 'docx', options: { rtlPageSetup: true } });
    expect(electron.dialog.showSaveDialog).toHaveBeenCalled();
    expect(wordMocks.exportDocument).toHaveBeenCalledWith({ html: '<p>x</p>' }, 'docx', 'C:\\Users\\me\\out.docx', { rtlPageSetup: true });
    expect(res).toMatchObject({ cancelled: false, outputPath: 'C:\\Users\\me\\out.docx' });
  });

  it('word:export returns {cancelled:true} when the save dialog is dismissed', async () => {
    electron.dialog.showSaveDialog = vi.fn(async () => ({ canceled: true, filePath: undefined }));
    const res = await invoke({ action: 'word:export', html: '<p>x</p>', title: 'D', to: 'pdf' });
    expect(res).toEqual({ cancelled: true });
    expect(wordMocks.exportDocument).not.toHaveBeenCalled();
    electron.dialog.showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: 'C:\\Users\\me\\out.docx' }));
  });

  it('openPath forwards to shell.openPath', async () => {
    await invoke({ action: 'openPath', path: 'C:\\Users\\me\\out.docx' });
    expect((electron as unknown as { shell: { openPath: ReturnType<typeof vi.fn> } }).shell.openPath).toHaveBeenCalled();
  });
});

describe('bad input', () => {
  it('an unknown action throws, naming it', async () => {
    await expect(invoke({ action: 'word:frobnicate' })).rejects.toThrow(/frobnicate/);
  });

  it('a missing action throws rather than silently resolving', async () => {
    await expect(invoke({})).rejects.toThrow();
  });
});
