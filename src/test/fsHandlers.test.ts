// @vitest-environment node
// electron/ipc/fsHandlers.ts — FS_INVOKE's action switch (SPEC-M8 P7). The
// project-folder module is exercised directly by projectFolder.test.ts; this
// covers the IPC seam: the channel is on the allowlist, chapter read/write go
// through the Word adapter (never a raw copy that would strip Word's own
// structure), a write backs up first, and an unknown action fails loudly.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createElectronMock } from './helpers/electronMock';
import { isAllowedIpcChannel, ALLOWED_IPC_CHANNELS } from '../../electron/ipc/registry';

const electron = createElectronMock();
electron.dialog.showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['C:\\Users\\me\\thesis'] }));
vi.mock('electron', () => electron);

const wordMock = {
  fromWord: vi.fn(async (_src: string, _to: string, out: string) => { fs.writeFileSync(out, '<p>chapter html</p>'); return { outputPath: out, ms: 1 }; }),
  toWord: vi.fn(async (_input: unknown, out: string) => { fs.writeFileSync(out, 'DOCX-BYTES'); return { outputPath: out, ms: 1 }; }),
  readStructure: vi.fn(async () => ({ headings: ['A'], footnotes: [], trackedChanges: 0, wordCount: 5, readingOrder: 'rtl' })),
};
vi.mock('../../electron/adapters/word.ts', () => wordMock);

let mod: typeof import('../../electron/ipc/fsHandlers.ts');
let root: string;

beforeAll(async () => {
  mod = await import('../../electron/ipc/fsHandlers.ts');
  mod.registerFsHandlers();
});

beforeEach(() => {
  vi.clearAllMocks();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fsh-'));
});

const invoke = (payload: Record<string, unknown>) => electron.invoke('fs:invoke', payload);

describe('registry', () => {
  it('registers FS_INVOKE and FS_CHANGED', () => {
    expect(ALLOWED_IPC_CHANNELS.FS_INVOKE).toBe('fs:invoke');
    expect(ALLOWED_IPC_CHANNELS.FS_CHANGED).toBe('fs:changed');
    expect(isAllowedIpcChannel('fs:invoke')).toBe(true);
    expect(isAllowedIpcChannel('fs:wander-anywhere')).toBe(false);
  });
});

describe('pickFolder / open', () => {
  it('pickFolder returns the chosen directory', async () => {
    await expect(invoke({ action: 'pickFolder' })).resolves.toEqual({ cancelled: false, path: 'C:\\Users\\me\\thesis' });
  });

  it('openProject adopts a folder of .docx files', async () => {
    fs.writeFileSync(path.join(root, '01.docx'), 'x');
    const pf = await invoke({ action: 'openProject', path: root }) as { chapters: Array<{ name: string }> };
    expect(pf.chapters.map((c) => c.name)).toEqual(['01.docx']);
  });
});

describe('readChapterHtml', () => {
  it('converts the chapter through Word and returns html + structure', async () => {
    fs.writeFileSync(path.join(root, 'ch.docx'), 'x');
    const res = await invoke({ action: 'readChapterHtml', root, name: 'ch.docx' }) as { html: string; structure: unknown };
    expect(wordMock.fromWord).toHaveBeenCalledWith(expect.stringContaining('ch.docx'), 'html', expect.stringMatching(/\.html$/));
    expect(res.html).toContain('chapter html');
    expect(res.structure).toMatchObject({ readingOrder: 'rtl' });
  });

  it('refuses a chapter name that escapes the folder', async () => {
    await expect(invoke({ action: 'readChapterHtml', root, name: '../secret.docx' })).rejects.toThrow();
    expect(wordMock.fromWord).not.toHaveBeenCalled();
  });
});

describe('saveChapter', () => {
  it('backs up the existing file, then writes the new .docx via Word', async () => {
    fs.writeFileSync(path.join(root, 'ch.docx'), 'OLD');
    const res = await invoke({ action: 'saveChapter', root, name: 'ch.docx', html: '<p>new</p>' }) as { backupPath: string | null };
    expect(res.backupPath).not.toBeNull();
    expect(fs.readFileSync(res.backupPath!, 'utf8')).toBe('OLD');
    expect(wordMock.toWord).toHaveBeenCalledWith({ html: '<p>new</p>' }, expect.stringContaining('ch.docx'), expect.anything());
    expect(fs.readFileSync(path.join(root, 'ch.docx'), 'utf8')).toBe('DOCX-BYTES');
  });

  it('a new chapter has no backup and lands in the manifest', async () => {
    await invoke({ action: 'openProject', path: root });
    const res = await invoke({ action: 'saveChapter', root, name: '02-new.docx', html: '<p>x</p>' }) as { backupPath: string | null };
    expect(res.backupPath).toBeNull();
    const order = JSON.parse(fs.readFileSync(path.join(root, '.easyeditor', 'project.json'), 'utf8')).chapterOrder;
    expect(order).toContain('02-new.docx');
  });
});

describe('bad input', () => {
  it('an unknown action throws, naming it', async () => {
    await expect(invoke({ action: 'rm-rf' })).rejects.toThrow(/rm-rf/);
  });
});
