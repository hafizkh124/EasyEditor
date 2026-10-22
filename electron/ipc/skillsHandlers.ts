/**
 * SkillsPanel (M11 Phase 3 / M12 Phase H, ADR-0047) — IPC handlers.
 *
 * One `SKILLS_INVOKE` channel with an action switch, the same shape as
 * `connectorsHandlers.ts`: `list` returns `PLAYBOOKS` + the scholar's custom
 * skills plus the merged enable state; `saveCustom` / `deleteCustom` manage the
 * custom ones; `setEnabled` flips the global or per-project switch. No
 * health probe — a playbook has nothing external to ping.
 */
import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { logger } from '../lib/logger.js';
import { PLAYBOOKS, mergeSkillState } from '../../shared/playbooks/registry.js';
import { readGlobalSkills, setGlobalSkill } from '../skills/globalStore.js';
import { readSkills, setSkill } from '../fs/projectFolder.js';
import { readCustomSkills, saveCustomSkill, deleteCustomSkill } from '../skills/customStore.js';
import { buildCustomSkill, parseSkillMarkdown } from '../../shared/playbooks/parseSkillMarkdown.js';

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
          const custom = readCustomSkills();
          return {
            playbooks: [...PLAYBOOKS, ...custom],
            custom,
            global,
            project,
            merged: mergeSkillState(global, project, custom),
          };
        }

        // Add/replace a custom skill from loose editor fields, or from the text
        // of an imported skill.md. Validation errors come back as data so the
        // dialog can show them; nothing is thrown for a bad skill.
        case 'saveCustom': {
          const built = typeof payload.markdown === 'string'
            ? parseSkillMarkdown(payload.markdown)
            : buildCustomSkill({
                id: typeof payload.id === 'string' ? payload.id : undefined,
                title: String(payload.title ?? ''),
                trigger: typeof payload.trigger === 'string' ? payload.trigger : undefined,
                keywords: Array.isArray(payload.keywords) ? payload.keywords.map(String) : [],
                guidance: typeof payload.guidance === 'string' ? payload.guidance : '',
                steps: Array.isArray(payload.steps) ? payload.steps.map(String) : [],
              });
          if (!built.ok) return { ok: false, errors: built.errors };
          try {
            return { ok: true, skill: built.skill, custom: saveCustomSkill(built.skill) };
          } catch (err) {
            return { ok: false, errors: [(err as Error).message] };
          }
        }

        case 'deleteCustom':
          return { custom: deleteCustomSkill(String(payload.id ?? '')) };

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
