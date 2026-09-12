/**
 * SkillsPanel (M11 Phase 3 / M12 Phase H, ADR-0047) — IPC handlers.
 *
 * One `SKILLS_INVOKE` channel with an action switch, the same shape as
 * `connectorsHandlers.ts`: `list` returns `PLAYBOOKS` plus the merged
 * enable state; `setEnabled` flips the global or per-project switch. No
 * health probe — a playbook has nothing external to ping.
 */
import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { logger } from '../lib/logger.js';
import { PLAYBOOKS, mergeSkillState } from '../../shared/playbooks/registry.js';
import { readGlobalSkills, setGlobalSkill } from '../skills/globalStore.js';
import { readSkills, setSkill } from '../fs/projectFolder.js';

const log = logger.child('ipc/skills');

export function registerSkillsHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.SKILLS_INVOKE,
    async (_event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload.action) {
        case 'list': {
          const projectRoot = typeof payload.projectRoot === 'string' ? payload.projectRoot : null;
          const global = readGlobalSkills();
          const project = projectRoot ? safeReadProject(projectRoot) : {};
          return {
            playbooks: PLAYBOOKS,
            global,
            project,
            merged: mergeSkillState(global, project),
          };
        }

        case 'setEnabled': {
          const id = String(payload.id ?? '');
          const on = payload.on === true;
          const scope = payload.scope === 'project' ? 'project' : 'global';
          if (scope === 'project') {
            const projectRoot = String(payload.projectRoot ?? '');
            if (!projectRoot) throw new Error('setEnabled scope:project needs a projectRoot');
            return { project: setSkill(projectRoot, id, on) };
          }
          return { global: setGlobalSkill(id, on) };
        }

        default:
          throw new Error(`unknown skills action: ${payload.action}`);
      }
    },
  );
}

function safeReadProject(root: string): Record<string, boolean> {
  try {
    return readSkills(root);
  } catch (err) {
    log.debug('readSkills failed', { message: (err as Error).message });
    return {};
  }
}
