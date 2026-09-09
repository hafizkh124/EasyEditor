// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createElectronMock } from './helpers/electronMock';
import { writeSyntheticHadithDb } from './helpers/jkhssnFixture';

const electron = createElectronMock();
vi.mock('electron', () => electron);

let userData: string;

const fakeResearchSearch = vi.fn(async (_mode: string, _query: string) => ({
  answer: 'شعبة بن الحجاج إمام حافظ متقن، أمير المؤمنين في الحديث.',
  citations: [
    { domain: 'classical-rijal', url: 'https://x/1', citation_ref: { book: 'تهذيب الكمال', page: '12/479' } },
    { domain: 'islamicurdubooks-rijal', citation_ref: { name_ar: 'شعبة بن الحجاج', shuhra_ar: 'شعبة' } },
  ],
}));

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jkhssn-agent-'));
  userData = path.join(tmp, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  electron.app.getPath.mockImplementation((k: string) => (k === 'userData' ? userData : (() => { throw new Error(k); })()));
  process.env.JKHSSN_NO_CANDIDATE_SCAN = '1';
  process.env.JKHSSN_DATA_PATH = writeSyntheticHadithDb(tmp);
  const { buildJkhssnIndex } = await import('../../electron/jkhssn/buildIndex');
  await buildJkhssnIndex({ dataPath: process.env.JKHSSN_DATA_PATH, outPath: path.join(userData, 'jkhssn.sqlite') });
});

afterAll(async () => {
  const { closeJkhssnDb } = await import('../../electron/jkhssn/indexDb');
  closeJkhssnDb();
  delete process.env.JKHSSN_NO_CANDIDATE_SCAN;
  delete process.env.JKHSSN_DATA_PATH;
  fs.rmSync(path.dirname(userData), { recursive: true, force: true });
});

async function adapter() {
  return import('../../electron/agent/adapters/jkhssn');
}

describe('agent jkhssn adapter', () => {
  it('jkhssnNarrator merges the local card with bridge citations', async () => {
    const { jkhssnNarrator } = await adapter();
    const r = await jkhssnNarrator({ name: 'شعبة', aspect: 'all' }, { researchSearch: fakeResearchSearch });
    expect(r.error).toBeUndefined();
    const card = r.data as { jkRawyId: number; martabaIbnHajar: string | null };
    expect(card.jkRawyId).toBe(11);
    expect(card.martabaIbnHajar).toContain('ثقة');
    expect(r.chunks.map((c) => c.reference)).toContain('تهذيب الكمال، 12/479');
    expect(fakeResearchSearch).toHaveBeenCalledWith('islamic', expect.stringContaining('شعبة'));
  });

  it('jkhssnNarrator on an unknown name returns a soft note, not an error', async () => {
    const { jkhssnNarrator } = await adapter();
    const r = await jkhssnNarrator({ name: 'لا أحد', aspect: 'all' }, { researchSearch: fakeResearchSearch });
    expect(r.error).toBeUndefined();
    expect(r.note).toMatch(/lookup_narrator/);
  });

  it('jkhssnSanadTree returns the tree payload for a hadith id', async () => {
    const { jkhssnSanadTree } = await adapter();
    const r = await jkhssnSanadTree({ hadithMainId: 10 });
    const tree = r.data as { chains: unknown[]; rawyIds: number[] };
    expect(tree.chains.length).toBe(1);
    expect(tree.rawyIds).toEqual(expect.arrayContaining([11, 22, 33]));
  });

  it('jkhssnSanadTree without an id asks for the collection + number', async () => {
    const { jkhssnSanadTree } = await adapter();
    const r = await jkhssnSanadTree({ hadithText: 'إنما الأعمال بالنيات' });
    expect(r.data).toBeUndefined();
    expect(r.note).toMatch(/نمبر/);
  });

  it('jkhssnJudgments yields citable chunks from the local rulings', async () => {
    const { jkhssnJudgments } = await adapter();
    const r = await jkhssnJudgments({ hadithMainId: 10 });
    expect(r.chunks[0].content).toContain('صحيح على شرط الشيخين');
    expect(r.chunks[0].reference).toContain('جوامع الكلم');
  });
});
