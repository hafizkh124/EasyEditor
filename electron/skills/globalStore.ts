/**
 * SkillsPanel (M11 Phase 3 / M12 Phase H, ADR-0047) — the GLOBAL skill switch
 * layer.
 *
 * "Is this playbook available on this machine?" — edited from Settings →
 * Skills, stored in `userData/skills.json`. Sits UNDER the per-project map
 * (`.easyeditor/project.json`, `electron/fs/projectFolder.ts`); a skill is
 * offered only when `mergeSkillState(global, project)` says on. Same shape
 * as `electron/connectors/globalStore.ts`, minus the `defaultOff` concept —
 * every playbook defaults on.
 *
 * Derived, disposable state — deleting the file just resets every skill on.
 */
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { logger } from '../lib/logger.js';
import { PLAYBOOKS } from '../../shared/playbooks/registry.js';
import { readCustomSkills } from './customStore.js';

const log = logger.child('skills/globalStore');
const FILE = 'skills.json';

interface GlobalSkillFile {
  enabled: Record<string, boolean>;
}

function storePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

/** The global enable map (absent id = on). */
export function readGlobalSkills(): Record<string, boolean> {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as Partial<GlobalSkillFile>;
    const src = raw?.enabled;
    if (!src || typeof src !== 'object') return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(src)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/**
 * Flip one skill on/off globally and persist. Turning it back on drops the
 * key (absent = on). Unknown ids (neither built-in nor a saved custom skill) are rejected.
 */
export function setGlobalSkill(id: string, on: boolean): Record<string, boolean> {
  const known = PLAYBOOKS.some((pb) => pb.id === id) || readCustomSkills().some((pb) => pb.id === id);
  if (!known) {
    log.warn('ignored unknown playbook id', { id });
    return readGlobalSkills();
  }
  const enabled = readGlobalSkills();
  if (on) delete enabled[id];
  else enabled[id] = false;
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), `${JSON.stringify({ enabled }, null, 2)}\n`, 'utf8');
  } catch (err) {
    log.warn('could not write skills.json', { message: (err as Error).message });
  }
  return enabled;
}
