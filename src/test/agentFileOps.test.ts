// @vitest-environment node
// M13 Phase 5 (ADR-0061) — organize_files: documents only, never delete,
// never overwrite, and every move/copy is undoable.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseFileList, resolveDestination, planFileOps, applyFileOps, undoFileOps, freeName, assertMovableDocument } from '../../electron/agent/fileOps';

const base = path.join(process.cwd(), 'test-results', `fileops-${process.pid}`);
let n = 0;
let src: string;
let dst: string;
beforeEach(() => {
  const root = path.join(base, String(n++));
  src = path.join(root, 'src');
  dst = path.join(root, 'dst');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(dst, { recursive: true });
});
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

const mk = (dir: string, name: string, body = name) => { const p = path.join(dir, name); fs.writeFileSync(p, body); return p; };

describe('parseFileList', () => {
  it('accepts a JSON array or one path per line, de-duplicated', () => {
    expect(parseFileList('["a","b","a"]')).toEqual(['a', 'b']);
    expect(parseFileList('a\n\nb\r\n')).toEqual(['a', 'b']);
    expect(() => parseFileList('')).toThrow(/no files/);
  });
});

describe('guards', () => {
  it('refuses executables, lock files and missing files', () => {
    expect(() => assertMovableDocument(mk(src, 'x.exe'))).toThrow(/only documents/);
    expect(() => assertMovableDocument(mk(src, '~$lock.docx'))).toThrow(/lock file/);
    expect(() => assertMovableDocument(path.join(src, 'nope.docx'))).toThrow(/not found/);
  });
  it('destination: absolute, parent must exist, never a drive root', () => {
    expect(() => resolveDestination('relative')).toThrow(/full path/);
    expect(resolveDestination(path.join(dst, 'new'))).toEqual({ dir: path.join(dst, 'new'), create: true });
    expect(() => resolveDestination(path.join(dst, 'a', 'b'))).toThrow(/parent folder does not exist/);
    expect(() => resolveDestination(path.parse(process.cwd()).root)).toThrow(/root of a drive/);
  });
});

describe('copy / move / undo', () => {
  it('copies without touching originals and never overwrites (name clash → "(2)")', () => {
    const a = mk(src, 'فتوی 1.docx', 'new');
    mk(dst, 'فتوی 1.docx', 'existing');
    const plan = planFileOps([a], dst, 'copy');
    expect(path.basename(plan[0].to)).toBe('فتوی 1 (2).docx');
    const r = applyFileOps(plan, { dir: dst, create: false });
    expect(r.done).toHaveLength(1);
    expect(fs.readFileSync(path.join(dst, 'فتوی 1.docx'), 'utf8')).toBe('existing');
    expect(fs.readFileSync(path.join(dst, 'فتوی 1 (2).docx'), 'utf8')).toBe('new');
    expect(fs.existsSync(a)).toBe(true);
  });

  it('moves into a new folder and undo puts every file back', () => {
    const a = mk(src, 'a.docx');
    const b = mk(src, 'b.pdf');
    const target = path.join(dst, 'collected');
    const dest = resolveDestination(target);
    const r = applyFileOps(planFileOps([a, b], dest.dir, 'move'), dest);
    expect(r.done).toHaveLength(2);
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(path.join(target, 'a.docx'))).toBe(true);
    const u = undoFileOps(r.done);
    expect(u.undone).toBe(2);
    expect(fs.existsSync(a) && fs.existsSync(b)).toBe(true);
    expect(fs.readdirSync(target)).toHaveLength(0);
  });

  it('undo of a copy removes the copy only when it is unchanged', () => {
    const a = mk(src, 'c.docx', 'same');
    const r = applyFileOps(planFileOps([a], dst, 'copy'), { dir: dst, create: false });
    fs.writeFileSync(r.done[0].to, 'edited since — longer');
    const u = undoFileOps(r.done);
    expect(u.undone).toBe(0);
    expect(u.skipped[0].reason).toMatch(/changed/);
    expect(fs.existsSync(r.done[0].to)).toBe(true);
  });

  it('undo of a move leaves the file if the original spot is occupied again', () => {
    const a = mk(src, 'd.docx');
    const r = applyFileOps(planFileOps([a], dst, 'move'), { dir: dst, create: false });
    mk(src, 'd.docx', 'a new file with the same name');
    const u = undoFileOps(r.done);
    expect(u.skipped[0].reason).toMatch(/occupied/);
    expect(fs.existsSync(r.done[0].to)).toBe(true);
  });

  it('freeName skips names reserved earlier in the same plan', () => {
    const taken = new Set([path.join(dst, 'x.docx').toLowerCase()]);
    expect(path.basename(freeName(dst, 'x.docx', taken))).toBe('x (2).docx');
  });
});
