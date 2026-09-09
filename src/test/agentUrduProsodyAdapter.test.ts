// @vitest-environment node
// electron/agent/adapters/urduProsody.ts (ADR-0042). scan_urdu_prosody is pure
// compute; lookup_urdu_verse reads a bundled JSON that ships EMPTY.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElectronMock } from './helpers/electronMock';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ee-prosody-'));
const electron = createElectronMock();
const app = electron.app as unknown as { getAppPath: () => string };
app.getAppPath = vi.fn(() => tmp);
vi.mock('electron', () => electron);

let mod: typeof import('../../electron/agent/adapters/urduProsody');

beforeEach(async () => {
  vi.clearAllMocks();
  app.getAppPath = vi.fn(() => tmp);
  try { fs.rmSync(path.join(tmp, 'resources', 'prosody'), { recursive: true }); } catch { /* none */ }
  mod = await import('../../electron/agent/adapters/urduProsody');
  mod._resetCorpusCache();
});

afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

function writeCorpus(verses: unknown[]) {
  const dir = path.join(tmp, 'resources', 'prosody');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'urdu-verses.json'), JSON.stringify({ verses }));
}

describe('scanUrduProsody', () => {
  it('returns a per-line scan, always labelled a machine reading', () => {
    const r = mod.scanUrduProsody('فعولن فعولن فعولن فعولن\nمصرعِ ثانی');
    expect(r.lines).toHaveLength(2);
    expect(r.note).toMatch(/machine reading/i);
    expect(r.lines[0].bahr).toBe('متقارب');
  });
});

describe('lookupUrduVerse', () => {
  it('with no bundled corpus, returns a clear note (not an error)', async () => {
    const r = await mod.lookupUrduVerse('نقش فریادی');
    expect(r.error).toBeUndefined();
    expect(r.note).toMatch(/no urdu verse corpus is bundled/i);
    expect(r.chunks).toEqual([]);
  });

  it('an empty query is an error', async () => {
    expect((await mod.lookupUrduVerse('  ')).error).toMatch(/search phrase/);
  });

  it('matches a bundled verse and returns a citable chunk', async () => {
    writeCorpus([
      { id: 'ghalib-1', poet: 'مرزا غالب', work: 'دیوانِ غالب', ghazal: 1, text: 'نقش فریادی ہے کس کی شوخیِ تحریر کا' },
    ]);
    mod._resetCorpusCache();
    const r = await mod.lookupUrduVerse('شوخیِ تحریر');
    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].id).toBe('urdu:ghalib-1');
    expect(r.chunks[0].reference).toMatch(/مرزا غالب، دیوانِ غالب، غزل 1/);
  });

  it('a non-matching query against a real corpus → a note', async () => {
    writeCorpus([{ id: 'g1', poet: 'غالب', text: 'ابن مریم ہوا کرے کوئی' }]);
    mod._resetCorpusCache();
    const r = await mod.lookupUrduVerse('zzzzz');
    expect(r.chunks).toEqual([]);
    expect(r.note).toMatch(/no matching verse/i);
  });
});
