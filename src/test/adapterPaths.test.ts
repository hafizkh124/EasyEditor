// @vitest-environment node
// electron/adapters/paths.ts — the P2 path guards (SPEC-M8 §3 "Security
// gates" #2). P7 will tighten "output must be inside the project folder";
// until then this is the boundary, so the extension allowlist, the
// absolute-path requirement, the system-directory block, and the
// "parent dir must be a real directory" checks all need to hold.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { assertSafeOutputPath, assertReadableFile, UnsafePathError } from '../../electron/adapters/paths';

let dir: string;
let realFile: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-paths-'));
  realFile = path.join(dir, 'in.docx');
  fs.writeFileSync(realFile, 'x');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('assertSafeOutputPath', () => {
  it('accepts an absolute path with an allowed extension into an existing dir', () => {
    const p = path.join(dir, 'out.docx');
    expect(assertSafeOutputPath(p, ['.docx'])).toBe(path.resolve(p));
  });

  it('rejects a relative path', () => {
    expect(() => assertSafeOutputPath('out.docx', ['.docx'])).toThrow(UnsafePathError);
  });

  it('rejects a disallowed extension', () => {
    expect(() => assertSafeOutputPath(path.join(dir, 'out.exe'), ['.docx'])).toThrow(/not allowed/);
  });

  it('rejects a null byte', () => {
    expect(() => assertSafeOutputPath(path.join(dir, 'o\0ut.docx'), ['.docx'])).toThrow(UnsafePathError);
  });

  it('rejects writing into a system directory', () => {
    const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'evil.docx');
    expect(() => assertSafeOutputPath(sys, ['.docx'])).toThrow(/system directory/);
  });

  it('rejects when the parent directory does not exist', () => {
    expect(() => assertSafeOutputPath(path.join(dir, 'nope', 'out.docx'), ['.docx'])).toThrow(/does not exist/);
  });

  it('rejects a non-string', () => {
    expect(() => assertSafeOutputPath(undefined, ['.docx'])).toThrow(UnsafePathError);
  });
});

describe('assertReadableFile', () => {
  it('accepts an existing file with an allowed extension', () => {
    expect(assertReadableFile(realFile, ['.docx'])).toBe(path.resolve(realFile));
  });

  it('rejects a missing file', () => {
    expect(() => assertReadableFile(path.join(dir, 'ghost.docx'), ['.docx'])).toThrow(/not found/);
  });

  it('rejects a directory', () => {
    expect(() => assertReadableFile(dir)).toThrow(/not a file/);
  });

  it('rejects a disallowed extension even if the file exists', () => {
    const f = path.join(dir, 'in.rtf');
    fs.writeFileSync(f, 'x');
    expect(() => assertReadableFile(f, ['.docx'])).toThrow(/not allowed/);
  });

  it('skips the extension check when no allowlist is given', () => {
    expect(assertReadableFile(realFile)).toBe(path.resolve(realFile));
  });
});
