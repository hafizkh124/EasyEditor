// @vitest-environment node
// M13 Phase 0 (ADR-0056) — edits to a file OUTSIDE the project folder: the
// sibling `.bak` naming, the validation guards (system / AppData dirs, Word
// lock files), and "Restore original". Real files, under the repo's
// git-ignored test-results/ (os.tmpdir() is itself under AppData, which the
// guard deliberately refuses).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  backupStamp,
  backupPathFor,
  backupBeside,
  isBackupOf,
  isOpenInWord,
  isInsideFolder,
  resolveExternalTarget,
  restoreFromBackup,
} from '../../electron/agent/externalFiles';

const base = path.join(process.cwd(), 'test-results', `ext-files-${process.pid}`);
let dir: string;
let n = 0;

beforeEach(() => {
  dir = path.join(base, String(n++));
  fs.mkdirSync(dir, { recursive: true });
});
afterAll(() => { fs.rmSync(base, { recursive: true, force: true }); });

describe('backup naming', () => {
  it('uses the blueprint format <name>.<yyyyMMdd_HHmmss>.bak', () => {
    const d = new Date(2026, 8, 28, 23, 15, 0);
    expect(backupStamp(d)).toBe('20260928_231500');
    expect(backupPathFor('D:\\x\\document.docx', d)).toBe('D:\\x\\document.docx.20260928_231500.bak');
  });

  it('recognises only its own backups for a given file', () => {
    const f = path.join(dir, 'a.docx');
    expect(isBackupOf(f, `${f}.20260928_231500.bak`)).toBe(true);
    expect(isBackupOf(f, `${f}.20260928_231500_2.bak`)).toBe(true);
    expect(isBackupOf(f, path.join(dir, 'b.docx.20260928_231500.bak'))).toBe(false);
    expect(isBackupOf(f, `${f}.bak`)).toBe(false);
    expect(isBackupOf(f, `${f}.20260928_231500.bak.exe`)).toBe(false);
  });
});

describe('backupBeside / restoreFromBackup', () => {
  it('copies the original beside itself and never overwrites an earlier backup', () => {
    const f = path.join(dir, 'thesis.docx');
    fs.writeFileSync(f, 'v1');
    const d = new Date(2026, 8, 28, 10, 0, 0);
    const b1 = backupBeside(f, d);
    fs.writeFileSync(f, 'v2');
    const b2 = backupBeside(f, d); // same second → suffixed, not clobbered
    expect(b1).toBe(`${f}.20260928_100000.bak`);
    expect(b2).toBe(`${f}.20260928_100000_2.bak`);
    expect(fs.readFileSync(b1, 'utf8')).toBe('v1');
    expect(fs.readFileSync(b2, 'utf8')).toBe('v2');
  });

  it('restores the original content from its backup', () => {
    const f = path.join(dir, 'fatwa.docx');
    fs.writeFileSync(f, 'original');
    const b = backupBeside(f);
    fs.writeFileSync(f, 'edited by the agent');
    restoreFromBackup(f, b);
    expect(fs.readFileSync(f, 'utf8')).toBe('original');
    expect(fs.existsSync(b)).toBe(true); // the backup is kept
  });

  it('refuses a backup that does not belong to the file', () => {
    const f = path.join(dir, 'x.docx');
    const other = path.join(dir, 'y.docx');
    fs.writeFileSync(f, 'x');
    fs.writeFileSync(other, 'y');
    const b = backupBeside(other);
    expect(() => restoreFromBackup(f, b)).toThrow(/does not belong/);
  });
});

describe('resolveExternalTarget guards', () => {
  it('accepts an existing .docx by absolute path', () => {
    const f = path.join(dir, 'ok.docx');
    fs.writeFileSync(f, 'x');
    expect(resolveExternalTarget(f)).toBe(path.resolve(f));
  });

  it('rejects a relative path, a missing file and a non-document extension', () => {
    expect(() => resolveExternalTarget('ok.docx')).toThrow(/absolute/);
    expect(() => resolveExternalTarget(path.join(dir, 'missing.docx'))).toThrow(/not found/);
    const exe = path.join(dir, 'run.exe');
    fs.writeFileSync(exe, 'MZ');
    expect(() => resolveExternalTarget(exe)).toThrow(/extension/);
  });

  it('refuses a document that is open in Word (its ~$ lock file is present)', () => {
    const f = path.join(dir, 'Thesis_Chapter1.docx');
    fs.writeFileSync(f, 'x');
    expect(isOpenInWord(f)).toBe(false);
    fs.writeFileSync(path.join(dir, '~$esis_Chapter1.docx'), 'lock');
    expect(isOpenInWord(f)).toBe(true);
    expect(() => resolveExternalTarget(f)).toThrow(/open in Word/);
  });

  it.runIf(process.platform === 'win32')('refuses files under AppData', () => {
    const appDataDoc = path.join(os.homedir(), 'AppData', 'Local', 'Temp', `ee-ext-${process.pid}.docx`);
    fs.writeFileSync(appDataDoc, 'x');
    try {
      expect(() => resolveExternalTarget(appDataDoc)).toThrow(/application-data/);
    } finally {
      fs.rmSync(appDataDoc, { force: true });
    }
  });
});

describe('isInsideFolder', () => {
  // Windows-only semantics (drive-letter paths / C:\Windows / case-insensitive compare) — runs on Windows, skipped on POSIX CI.
  it.skipIf(process.platform !== 'win32')('is case-insensitive and does not match a sibling prefix', () => {
    expect(isInsideFolder('C:\\Proj', 'c:\\proj\\01.docx')).toBe(true);
    expect(isInsideFolder('C:\\Proj', 'C:\\Project2\\01.docx')).toBe(false);
    expect(isInsideFolder(null, 'C:\\Proj\\01.docx')).toBe(false);
  });
});
