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

beforeAll(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jkhssn-axes-'));
  userData = path.join(tmp, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  electron.app.getPath.mockImplementation((k: string) => {
    if (k === 'userData') return userData;
    throw new Error(k);
  });

  const dataPath = writeSyntheticHadithDb(tmp);
  const { buildJkhssnIndex } = await import('../../electron/jkhssn/buildIndex');
  await buildJkhssnIndex({ dataPath, outPath: path.join(userData, 'jkhssn.sqlite') });
});

afterAll(async () => {
  const { closeJkhssnDb } = await import('../../electron/jkhssn/indexDb');
  closeJkhssnDb();
  fs.rmSync(path.dirname(userData), { recursive: true, force: true });
});

async function axes() {
  return import('../../electron/jkhssn/axes');
}

describe('jkhssn axes (against a synthetic index)', () => {
  it('axis 3 — narrator by name: bio + jarh + teachers/students', async () => {
    const { axisNarrator } = await axes();
    const n = axisNarrator({ nameQuery: 'شعبة' });
    expect(n).not.toBeNull();
    expect(n!.jkRawyId).toBe(11);
    expect(n!.nameShapes[0]).toBe('شعبة');
    expect(n!.martabaIbnHajar).toBe('ثقة حافظ متقن');
    expect(n!.deathYear).toBe('160 هـ');
    expect(n!.jarh.map((j) => j.verdict)).toContain('ثقة');
    expect(n!.jarh.find((j) => j.criticSay)?.criticSay).toContain('أحمد');
    expect(n!.teachers.map((t) => t.id)).toContain(33);
    expect(n!.students.map((s) => s.id)).toContain(22);
    expect(n!.needsNames).toEqual(expect.arrayContaining([11, 33, 22]));
  });

  it('axis 2 — sanad tree for a hadith: ancestor path + flags + rawy ids', async () => {
    const { axisSanadTree } = await axes();
    const t = axisSanadTree({ hadithMainId: 10 });
    expect(t.chains.length).toBe(1);
    const ids = t.chains[0].nodes.map((x) => x.id).sort();
    expect(ids).toEqual([1, 2, 3]); // root -> 2 -> leaf
    expect(t.chains[0].nodes.find((x) => x.id === 3)!.isLeaf).toBe(true);
    expect(t.chains[0].nodes.every((x) => x.isMarfoa)).toBe(true);
    expect(t.rawyIds.sort()).toEqual([11, 22, 33]);
  });

  it('axis 5 — imam judgments for a hadith', async () => {
    const { axisJudgments } = await axes();
    const j = axisJudgments(10);
    expect(j.judgments[0].say).toContain('صحيح على شرط الشيخين');
    expect(j.degree).toBe(1);
    expect(j.scientistIds).toContain(5);
  });

  it('axis 1 — takhrīj: matn-group siblings + service flags', async () => {
    const { axisTakhrij } = await axes();
    const t = axisTakhrij(10);
    expect(t.entries.some((e) => e.hadithMainId === 20)).toBe(true); // shares group 7
    expect(t.bookIds.sort()).toEqual([1, 2]);
    expect(t.serviceState?.degree).toBe(1);
    expect(t.serviceState?.flags.Takhreg).toBe(true);
    expect(t.serviceState?.flags.Feqh).toBe(true);
    expect(t.serviceState?.flags.Rwah).toBe(false);
  });

  it('axis 6 — thematic drill-down: children + leaf hadith ids', async () => {
    const { axisThematic } = await axes();
    const root = axisThematic({ subjectId: 1 });
    expect(root.matches.map((m) => m.id).sort()).toEqual([2, 3]);
    expect(root.matches.find((m) => m.id === 2)!.hitCount).toBe(2);
    // subject.title is always '' today: SubjectTitle is a CustomType=1
    // (compressed) column, which buildIndex.ts's loadOneTable() deliberately
    // skips and stores NULL for (ADR-0045) — regardless of the SELECT above
    // naming the column. This is the documented current limitation, not a
    // bug; drill-through relies on id/parentId/hitCount until a real decoder
    // for compressed columns exists.
    expect(root.matches.find((m) => m.id === 2)!.title).toBe('');
    expect(root.matches.find((m) => m.id === 3)!.title).toBe('');
    const leaf = axisThematic({ subjectId: 2 });
    expect(leaf.hadithIds).toEqual(expect.arrayContaining([10, 20]));
  });

  it('FTS + book search', async () => {
    const { jkhssnFts, jkhssnSearchBooks } = await axes();
    const hits = jkhssnFts('كذاب', ['verdict']);
    expect(hits[0]).toMatchObject({ kind: 'verdict' });
    expect(hits[0].text).toBe('كذاب');
    expect(jkhssnSearchBooks('بخاري')[0].title).toContain('البخاري');
  });
});
