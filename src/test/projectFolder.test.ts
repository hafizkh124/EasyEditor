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

  it('rejects a path with separators, traversal, or a bad extension', () => {
    expect(() => resolveInProject(root, '../evil.docx')).toThrow();
    expect(() => resolveInProject(root, 'sub/ch.docx')).toThrow();
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
