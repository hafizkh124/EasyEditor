// @vitest-environment node
// electron/skills/globalStore.ts — the GLOBAL ("this machine") layer of the
// skill switch (M11 Phase 3 / M12 Phase H, ADR-0047). Mirrors what a
// connectors/globalStore.ts test would look like: a JSON file under
// userData, absent = every skill on, unknown ids rejected.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createElectronMock } from './helpers/electronMock';
import { PLAYBOOKS } from '../../shared/playbooks/registry';

const electron = createElectronMock();
vi.mock('electron', () => electron);

let dir: string;
let mod: typeof import('../../electron/skills/globalStore.ts');

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-global-'));
  (electron.app.getPath as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
    if (key === 'userData') return dir;
    throw new Error(`unexpected getPath("${key}")`);
  });
  vi.resetModules();
  mod = await import('../../electron/skills/globalStore.ts');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('readGlobalSkills', () => {
  it('returns {} when no file exists yet (every skill on by default)', () => {
    expect(mod.readGlobalSkills()).toEqual({});
  });

  it('ignores a corrupt file rather than throwing', () => {
    fs.writeFileSync(path.join(dir, 'skills.json'), 'not json', 'utf8');
    expect(mod.readGlobalSkills()).toEqual({});
  });

  it('drops non-boolean values from a hand-edited file', () => {
    fs.writeFileSync(path.join(dir, 'skills.json'), JSON.stringify({ enabled: { x: 'nope', y: true } }), 'utf8');
    expect(mod.readGlobalSkills()).toEqual({ y: true });
  });
});

describe('setGlobalSkill', () => {
  const realId = PLAYBOOKS[0].id;

  it('round-trips a switch and persists it to disk', () => {
    expect(mod.setGlobalSkill(realId, false)).toEqual({ [realId]: false });
    expect(mod.readGlobalSkills()).toEqual({ [realId]: false });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'skills.json'), 'utf8'));
    expect(onDisk).toEqual({ enabled: { [realId]: false } });
  });

  it('turning it back on deletes the key rather than storing true', () => {
    mod.setGlobalSkill(realId, false);
    expect(mod.setGlobalSkill(realId, true)).toEqual({});
    expect(mod.readGlobalSkills()).toEqual({});
  });

  it('rejects an unknown playbook id without throwing or writing', () => {
    expect(mod.setGlobalSkill('not-a-real-playbook', false)).toEqual({});
    expect(fs.existsSync(path.join(dir, 'skills.json'))).toBe(false);
  });
});
