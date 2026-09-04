// @vitest-environment node
// electron/fs/projectFolder.ts — the project-folder model (SPEC-M8 P7,
// ADR-0018). The folder of real files is the truth; this module only keeps a
// small `.easyeditor/` manifest (chapter order + id) and a backup before it
// lets anything overwrite a file. What must hold: opening a plain folder of
// .docx files adopts it without touching the files, chapter order is stable,
// `resolveInProject` blocks any path that escapes the folder, and a backup is
// taken before an existing chapter is registered as overwritten.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  createProjectFolder,
  openProjectFolder,
  refreshChapters,
  backupChapter,
  registerChapter,
  resolveInProject,
  readConnectors,
  setConnector,
} from '../../electron/fs/projectFolder';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const touch = (name: string, bytes = 'x') => fs.writeFileSync(path.join(root, name), bytes);

describe('createProjectFolder', () => {
  it('scaffolds sources/templates/export + .easyeditor and a manifest', () => {
    const dir = path.join(root, 'thesis');
    const pf = createProjectFolder(dir, 'My Thesis');
    expect(fs.existsSync(path.join(dir, 'sources'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'templates'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'export'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.easyeditor', 'project.json'))).toBe(true);
    expect(pf.manifest.title).toBe('My Thesis');
    expect(pf.manifest.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('refuses to scaffold into a non-empty folder', () => {
    touch('already-here.docx');
    expect(() => createProjectFolder(root, 'X')).toThrow(/not empty/);
  });
});

describe('openProjectFolder', () => {
  it('adopts a plain folder of .docx files without modifying them', () => {
    touch('01-intro.docx', 'INTRO');
    touch('02-body.docx', 'BODY');
    const pf = openProjectFolder(root);
    expect(pf.chapters.map((c) => c.name)).toEqual(['01-intro.docx', '02-body.docx']);
    expect(fs.readFileSync(path.join(root, '01-intro.docx'), 'utf8')).toBe('INTRO');
    expect(pf.manifest.chapterOrder).toEqual(['01-intro.docx', '02-body.docx']);
  });

  it('ignores Word lock files and non-chapter formats', () => {
    touch('01.docx');
    touch('~$01.docx');
    touch('notes.txt');
    touch('slides.pptx');
    expect(openProjectFolder(root).chapters.map((c) => c.name)).toEqual(['01.docx']);
  });

  it('recurses into per-section subfolders and returns relative paths', () => {
    fs.mkdirSync(path.join(root, '01-synopsis'));
    fs.mkdirSync(path.join(root, '02-body'));
    touch('01-synopsis/synopsis.docx', 'S');
    touch('02-body/draft-1.docx', 'D1');
    touch('02-body/draft-2.rtf', 'D2');
    touch('02-body/~$draft-1.docx');           // lock file — skipped
    touch('scratch-notes.json');               // not a chapter
    const names = openProjectFolder(root).chapters.map((c) => c.name);
    expect(names).toEqual(['01-synopsis/synopsis.docx', '02-body/draft-1.docx', '02-body/draft-2.rtf']);
  });

  it('skips the .easyeditor internal folder when scanning', () => {
    fs.mkdirSync(path.join(root, '.easyeditor', 'backups'), { recursive: true });
    touch('.easyeditor/backups/old__ch.docx', 'BACKUP');
    touch('real.docx', 'R');
    expect(openProjectFolder(root).chapters.map((c) => c.name)).toEqual(['real.docx']);
  });

  it('keeps the manifest order across reopen, appending new files last', () => {
    touch('b.docx'); touch('a.docx');
    let pf = openProjectFolder(root);
    // manifest now records [b? a?] by name sort since neither was ordered → a, b
    expect(pf.chapters.map((c) => c.name)).toEqual(['a.docx', 'b.docx']);
    touch('c.docx');
    pf = openProjectFolder(root);
    expect(pf.chapters.map((c) => c.name)).toEqual(['a.docx', 'b.docx', 'c.docx']);
  });
});

describe('resolveInProject', () => {
  it('resolves a bare chapter name inside the folder', () => {
    expect(resolveInProject(root, 'ch.docx')).toBe(path.join(path.resolve(root), 'ch.docx'));
  });

  it('resolves a NESTED chapter path (real theses nest a folder per section)', () => {
    expect(resolveInProject(root, '02-body/draft-3.docx')).toBe(path.join(path.resolve(root), '02-body', 'draft-3.docx'));
    expect(resolveInProject(root, '02-body\\draft.docx')).toBe(path.join(path.resolve(root), '02-body', 'draft.docx'));
  });

  it('rejects traversal, absolute paths, a bad extension, or a null byte', () => {
    expect(() => resolveInProject(root, '../evil.docx')).toThrow(/escapes/);
    expect(() => resolveInProject(root, '02-body/../../evil.docx')).toThrow(/escapes/);
    expect(() => resolveInProject(root, 'C:/Windows/x.docx')).toThrow(/relative/);
    expect(() => resolveInProject(root, '/etc/x.docx')).toThrow(/relative/);
    expect(() => resolveInProject(root, 'ch.exe')).toThrow(/format/);
    expect(() => resolveInProject(root, '')).toThrow();
    expect(() => resolveInProject(root, 'a\0b.docx')).toThrow();
  });
});

describe('backupChapter / registerChapter', () => {
  it('copies the existing file into .easyeditor/backups before it is overwritten', () => {
    touch('ch.docx', 'V1');
    const backup = backupChapter(root, 'ch.docx');
    expect(backup).not.toBeNull();
    expect(fs.readFileSync(backup!, 'utf8')).toBe('V1');
    expect(path.dirname(backup!)).toBe(path.join(path.resolve(root), '.easyeditor', 'backups'));
  });

  it('returns null when the chapter is new (nothing to back up)', () => {
    expect(backupChapter(root, 'new.docx')).toBeNull();
  });

  it('registerChapter adds a new chapter to the manifest order once', () => {
    openProjectFolder(root);
    touch('03-new.docx', 'NEW');
    registerChapter(root, '03-new.docx');
    registerChapter(root, '03-new.docx');
    const order = JSON.parse(fs.readFileSync(path.join(root, '.easyeditor', 'project.json'), 'utf8')).chapterOrder;
    expect(order.filter((n: string) => n === '03-new.docx')).toHaveLength(1);
  });
});

describe('refreshChapters', () => {
  it('reflects a file added on disk after open', () => {
    touch('01.docx');
    openProjectFolder(root);
    touch('02.docx');
    expect(refreshChapters(root).map((c) => c.name)).toEqual(['01.docx', '02.docx']);
  });
});

describe('connectors (M9 Phase 1b)', () => {
  it('round-trips a connector switch through the manifest, default all-on', () => {
    createProjectFolder(root, 'P');
    expect(readConnectors(root)).toEqual({});

    expect(setConnector(root, 'shamela', false)).toEqual({ shamela: false });
    expect(readConnectors(root)).toEqual({ shamela: false });

    // survives a re-open (which rewrites the manifest)
    openProjectFolder(root);
    expect(readConnectors(root)).toEqual({ shamela: false });

    // turning it back on deletes the key rather than storing `true`
    expect(setConnector(root, 'shamela', true)).toEqual({});
  });

  it('a default-off connector (repositories) stores an explicit true when turned on', () => {
    createProjectFolder(root, 'P');
    expect(setConnector(root, 'repositories', true)).toEqual({ repositories: true });
    openProjectFolder(root);
    expect(readConnectors(root)).toEqual({ repositories: true });
    expect(setConnector(root, 'repositories', false)).toEqual({}); // back to default-off
  });
});
