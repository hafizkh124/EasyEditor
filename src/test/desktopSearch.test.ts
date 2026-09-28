// @vitest-environment node
// M13 Phase 2 (ADR-0059) — "search my computer": the Windows Search SQL is
// built from sanitised pieces only, spelling variants cover Urdu/Arabic
// letter forms, and the directory-walk fallback is bounded.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  termVariants,
  foldForMatch,
  sanitizeSearchTerm,
  normaliseExtensions,
  folderScope,
  buildWindowsSearchSql,
  walkSearch,
  searchMyComputer,
} from '../../electron/host/desktopSearch';

describe('sanitizeSearchTerm', () => {
  it('strips quotes, LIKE wildcards, brackets and control chars', () => {
    expect(sanitizeSearchTerm(`fatwa' OR 1=1 --`)).toBe('fatwa OR 1=1 --');
    expect(sanitizeSearchTerm('50%_[x]"y";z*?')).toBe('50 x y z');
    expect(sanitizeSearchTerm('a\u0000b')).toBe('a b');
  });
});

describe('termVariants / foldForMatch', () => {
  it('covers diacritics and Urdu/Arabic letter forms', () => {
    const v = termVariants('فتویٰ');
    expect(v).toContain('فتویٰ');
    expect(v).toContain('فتوی');          // superscript alef removed
    expect(v).toContain('فتوي');          // Arabic yeh
    expect(v).toContain('فتوى');          // alef maqsura, as often typed
  });
  it('folds variants to one form for in-process matching', () => {
    expect(foldForMatch('فتوى')).toBe(foldForMatch('فتویٰ'));
    expect(foldForMatch('كتاب')).toBe(foldForMatch('کتاب'));
  });
});

describe('normaliseExtensions', () => {
  it('keeps only allow-listed document types', () => {
    expect(normaliseExtensions(['docx', '.PDF', 'exe', 'ps1', 'lnk'])).toEqual(['.docx', '.pdf']);
    expect(normaliseExtensions(undefined).length).toBeGreaterThan(5);
  });
});

describe('buildWindowsSearchSql', () => {
  it('file-name search: allow-listed IN list, LIKE per variant, lock files excluded', () => {
    const sql = buildWindowsSearchSql({ term: 'فتویٰ', mode: 'filename', exts: ['.docx'], scope: null, limit: 50 })!;
    expect(sql).toContain("SCOPE='file:'");
    expect(sql).toContain("(System.FileExtension = '.docx')");
    expect(sql).not.toContain(' IN ('); // unsupported by Windows Search SQL
    expect(sql).toContain("System.FileName LIKE '%فتوی%'");
    expect(sql).toContain("NOT System.FileName LIKE '~$%'");
    expect(sql).toMatch(/^SELECT TOP 50 /);
  });
  it('content search uses CONTAINS with the sanitised phrase', () => {
    const sql = buildWindowsSearchSql({ term: `نماز' --`, mode: 'content', exts: ['.pdf'], scope: 'file:D:/Books', limit: 10 })!;
    expect(sql).toContain(`CONTAINS(*, '"نماز --"')`);
    expect(sql).toContain("SCOPE='file:D:/Books'");
    expect(sql).not.toContain("''");
  });
  it('refuses an empty term and caps TOP', () => {
    expect(buildWindowsSearchSql({ term: `'%_`, mode: 'filename', exts: ['.docx'], scope: null, limit: 5 })).toBeNull();
    expect(buildWindowsSearchSql({ term: 'x', mode: 'filename', exts: ['.docx'], scope: null, limit: 9999 })).toMatch(/TOP 200 /);
  });
});

describe('folderScope', () => {
  it('only accepts an existing absolute directory', () => {
    expect(folderScope('relative/dir')).toBeNull();
    expect(folderScope(path.join(process.cwd(), 'no-such-dir-xyz'))).toBeNull();
    expect(folderScope(process.cwd())).toBe(`file:${path.resolve(process.cwd()).replace(/\\/g, '/')}`);
  });
});

describe('walkSearch (fallback)', () => {
  const root = path.join(process.cwd(), 'test-results', `walk-${process.pid}`);
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('finds matching documents, skips lock files / other types / node_modules, and stops at the limit', () => {
    fs.mkdirSync(path.join(root, 'sub', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'فتوى نمبر 1.docx'), 'x');
    fs.writeFileSync(path.join(root, 'sub', 'فتویٰ دوم.pdf'), 'x');
    fs.writeFileSync(path.join(root, '~$توى نمبر 1.docx'), 'lock');
    fs.writeFileSync(path.join(root, 'فتوى.exe'), 'MZ');
    fs.writeFileSync(path.join(root, 'sub', 'node_modules', 'فتوی.docx'), 'x');
    const hits = walkSearch({ term: 'فتوی', exts: ['.docx', '.pdf'], roots: [root], limit: 10 });
    expect(hits.map((h) => h.name).sort()).toEqual(['فتوى نمبر 1.docx', 'فتویٰ دوم.pdf'].sort());
    expect(walkSearch({ term: 'فتوی', exts: ['.docx', '.pdf'], roots: [root], limit: 1 })).toHaveLength(1);
  });
});

// Live: the real Windows Search index on this machine.
//     DESKTOP_SEARCH_LIVE=1 npx vitest run src/test/desktopSearch.test.ts
describe.runIf(process.env.DESKTOP_SEARCH_LIVE === '1' && process.platform === 'win32')('Windows Search (live)', () => {
  it('finds .docx files by name through the index', async () => {
    const r = await searchMyComputer({ query: 'a', mode: 'filename', extensions: ['docx'], limit: 5 });
    // eslint-disable-next-line no-console
    console.log('live desktop search', r.source, r.note, r.hits.map((h) => h.path));
    expect(r.source).toBe('windows-search');
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.every((h) => h.ext === '.docx' && !h.name.startsWith('~$'))).toBe(true);
  }, 60_000);
});

describe('isInternalCopy', () => {
  it('flags EasyEditor backup/history copies only', async () => {
    const { isInternalCopy } = await import('../../electron/host/desktopSearch');
    expect(isInternalCopy(path.win32.join('C:', 'Users', 'x', 'Downloads', '.easyeditor', 'backups', 'a.docx'))).toBe(true);
    expect(isInternalCopy('/home/x/.easyeditor/history/cp_1/a.docx')).toBe(true);
    expect(isInternalCopy(path.win32.join('C:', 'Users', 'x', 'Downloads', 'a.docx'))).toBe(false);
  });
});
