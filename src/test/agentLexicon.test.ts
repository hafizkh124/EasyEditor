// @vitest-environment node
// shared/agent/lexiconQuery.ts + electron/agent/adapters/lexicon.ts (ADR-0043).
// lookup_lexicon reuses the corpus's verified Arabic→Urdu lexical material and
// an al-Maany verify link — it never synthesises a gloss, and a printed-page
// citation appears ONLY when a real root→page index is bundled.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElectronMock } from './helpers/electronMock';
import { buildLexiconQuery, normaliseArabicWord, almaanyUrl } from '../../shared/agent/lexiconQuery';

describe('lexiconQuery (pure)', () => {
  it('buildLexiconQuery names the word and reads as a lughat question', () => {
    const q = buildLexiconQuery('سرابيل');
    expect(q).toContain('«سرابيل»');
    expect(q).toMatch(/المعنى اللغوي|مفردات|لغوی معنیٰ/);
  });

  it('normaliseArabicWord strips ḥarakāt and unifies hamza carriers', () => {
    expect(normaliseArabicWord('سَرَابِيل')).toBe('سرابيل');
    expect(normaliseArabicWord('أكبَر')).toBe('اكبر');
    expect(normaliseArabicWord('مُصْطَفى')).toBe('مصطفی'); // ى → ی
  });

  it('almaanyUrl percent-encodes the Arabic word', () => {
    const u = almaanyUrl('سرابيل');
    expect(u.startsWith('https://www.almaany.com/ur/dict/ar-ur/')).toBe(true);
    expect(u).toContain(encodeURIComponent('سرابيل'));
    expect(u.endsWith('/')).toBe(true);
  });
});

// ── the deferred printed-page index ──────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-lex-'));
const electron = createElectronMock();
const app = electron.app as unknown as { getAppPath: () => string };
app.getAppPath = vi.fn(() => tmp);
vi.mock('electron', () => electron);

let adapter: typeof import('../../electron/agent/adapters/lexicon');

beforeEach(async () => {
  vi.clearAllMocks();
  app.getAppPath = vi.fn(() => tmp);
  try { fs.rmSync(path.join(tmp, 'resources', 'lexicon'), { recursive: true }); } catch { /* none */ }
  adapter = await import('../../electron/agent/adapters/lexicon');
  adapter._resetPageMapCache();
});

afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

function writeMap(roots: unknown[]) {
  const dir = path.join(tmp, 'resources', 'lexicon');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'root-page-map.json'), JSON.stringify({ roots }));
}

describe('printedPageCitation', () => {
  it('returns null when no index is bundled (the default)', async () => {
    expect(await adapter.printedPageCitation('سرابيل')).toBeNull();
  });

  it('returns a citable page reference when the word is in a bundled index', async () => {
    writeMap([{ root: 'سربل', headword: 'سرابيل', misbah_page: 345, qamus_page: 812 }]);
    adapter._resetPageMapCache();
    const c = await adapter.printedPageCitation('سَرَابِيل'); // ḥarakāt tolerated
    expect(c).not.toBeNull();
    expect(c!.id).toBe('lexicon:page:سرابيل');
    expect(c!.reference).toMatch(/مصباح اللغات، ص 345/);
    expect(c!.reference).toMatch(/القاموس الوحيد، ص 812/);
  });

  it('returns null for a word not in the bundled index', async () => {
    writeMap([{ headword: 'كتاب', misbah_page: 900 }]);
    adapter._resetPageMapCache();
    expect(await adapter.printedPageCitation('سرابيل')).toBeNull();
  });
});
