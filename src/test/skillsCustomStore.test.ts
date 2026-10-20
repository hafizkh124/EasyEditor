// @vitest-environment node
// electron/skills/customStore.ts — the scholar's own skills, persisted under
// userData/custom-skills.json and re-validated on every read.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createElectronMock } from './helpers/electronMock';
import { parseSkillMarkdown } from '../../shared/playbooks/parseSkillMarkdown';
import type { Playbook } from '../../shared/playbooks/registry';

const electron = createElectronMock();
vi.mock('electron', () => electron);

let dir: string;
let mod: typeof import('../../electron/skills/customStore.ts');

const skill = (title = 'Mine'): Playbook => {
  const r = parseSkillMarkdown(`---\ntitle: ${title}\ntrigger: mine\nsteps: search_hadith\n---\nbody`);
  if (!r.ok) throw new Error('parse');
  return r.skill;
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-custom-'));
  (electron.app.getPath as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
    if (key === 'userData') return dir;
    throw new Error(`unexpected getPath("${key}")`);
  });
  vi.resetModules();
  mod = await import('../../electron/skills/customStore.ts');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('customStore', () => {
  it('is empty when no file exists and survives a corrupt file', () => {
    expect(mod.readCustomSkills()).toEqual([]);
    fs.writeFileSync(path.join(dir, 'custom-skills.json'), 'not json', 'utf8');
    expect(mod.readCustomSkills()).toEqual([]);
  });

  it('saves, replaces by id, and deletes', () => {
    mod.saveCustomSkill(skill('One'));
    expect(mod.saveCustomSkill(skill('Two'))).toHaveLength(1); // same id → replaced
    expect(mod.readCustomSkills()[0].title).toBe('Two');
    expect(mod.deleteCustomSkill(skill().id)).toEqual([]);
  });

  it('rejects an unsound skill and a built-in id clash', () => {
    expect(() => mod.saveCustomSkill({ ...skill(), id: 'zakat-assessment-workflow' })).toThrow();
    expect(() => mod.saveCustomSkill({ ...skill(), steps: [{ tool: 'rm_rf', note: 'x' }] })).toThrow();
  });

  it('drops hand-edited entries that name an unknown tool (the registry stays closed)', () => {
    const evil = { ...skill(), steps: [{ tool: 'run_shell', note: 'x' }] };
    fs.writeFileSync(path.join(dir, 'custom-skills.json'), JSON.stringify({ skills: [evil, skill()] }), 'utf8');
    expect(mod.readCustomSkills()).toHaveLength(1);
  });
});
