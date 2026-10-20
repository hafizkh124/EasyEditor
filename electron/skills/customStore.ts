/**
 * Custom skills — the scholar's own playbooks (Settings → Skills → Add / Import).
 *
 * Stored in `userData/custom-skills.json`, next to the global on/off map
 * (`globalStore.ts`). Every entry is re-validated on read with the same
 * `validatePlaybook` the built-ins pass, and may only name tools from the
 * closed registry — a hand-edited file can never add a capability.
 *
 * Derived, user-owned state: a missing or unreadable file is just "no custom
 * skills".
 */
import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { logger } from '../lib/logger.js';
import { PLAYBOOKS, type Playbook } from '../../shared/playbooks/registry.js';
import { validatePlaybook } from '../../shared/playbooks/executor.js';
import { CUSTOM_SKILL_PREFIX } from '../../shared/playbooks/parseSkillMarkdown.js';

const log = logger.child('skills/customStore');
const FILE = 'custom-skills.json';

function storePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

function isSound(v: unknown): v is Playbook {
  if (!v || typeof v !== 'object') return false;
  const p = v as Playbook;
  return (
    typeof p.id === 'string' && p.id.startsWith(CUSTOM_SKILL_PREFIX) &&
    typeof p.title === 'string' && Array.isArray(p.keywords) && Array.isArray(p.steps) &&
    validatePlaybook(p).length === 0
  );
}

export function readCustomSkills(): Playbook[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8')) as { skills?: unknown };
    return Array.isArray(raw?.skills) ? raw.skills.filter(isSound) : [];
  } catch {
    return [];
  }
}

function write(skills: Playbook[]): void {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true });
    fs.writeFileSync(storePath(), `${JSON.stringify({ skills }, null, 2)}\n`, 'utf8');
  } catch (err) {
    log.warn('could not write custom-skills.json', { message: (err as Error).message });
  }
}

/** Insert or replace by id. Throws on an unsound skill (the IPC layer reports it). */
export function saveCustomSkill(skill: Playbook): Playbook[] {
  if (!isSound(skill)) throw new Error('invalid custom skill');
  if (PLAYBOOKS.some((p) => p.id === skill.id)) throw new Error('id clashes with a built-in skill');
  const rest = readCustomSkills().filter((s) => s.id !== skill.id);
  const next = [...rest, skill];
  write(next);
  return next;
}

export function deleteCustomSkill(id: string): Playbook[] {
  const next = readCustomSkills().filter((s) => s.id !== id);
  write(next);
  return next;
}
