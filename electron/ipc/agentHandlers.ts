/**
 * M8 Layer 6 — agent IPC (SPEC-M8 §3, ADR-0016).
 *
 * `AGENT_INVOKE` action-dispatched: `run` (start a task), `cancel`, `status`.
 * `AGENT_PROGRESS` streams the live step-by-step line the Agent chat renders.
 * One task at a time (./agent/queue.ts). The full transcript is written to
 * `task_runs` so the Trust tab shows every tool call (ADR-0016 control 4).
 *
 * Gated in the renderer by `isDesktop()` + `VITE_AGENT_MODE`; the handler is
 * always registered but every path needs an open project folder.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { logger } from '../lib/logger.js';
import { runAgent } from '../agent/run.js';
import { acquireAgentSlot, releaseAgentSlot, cancelRunningAgent, runningTask } from '../agent/queue.js';
import { getWorkspaceDbService } from './workspaceHandlers.js';
import type { AgentProgress } from '../../shared/agent/types.js';

const log = logger.child('ipc/agent');

export function registerAgentHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.AGENT_INVOKE,
    async (event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload?.action) {
        case 'status':
          return { busy: runningTask() !== null, running: runningTask() };

        case 'cancel':
          return { cancelled: cancelRunningAgent() };

        case 'run': {
          const instruction = String(payload.instruction ?? '').trim();
          const mode = payload.mode === 'do' ? 'do' : 'ask';
          const projectRoot = String(payload.projectRoot ?? '');
          if (!instruction) throw new Error('instruction is required');
          if (!projectRoot) throw new Error('open a project folder first');

          const id = randomUUID();
          let cancelled = false;
          acquireAgentSlot(id, () => { cancelled = true; });

          const win = BrowserWindow.fromWebContents(event.sender);
          const emit = (p: AgentProgress) =>
            win?.webContents.send(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, { id, ...p });

          let runId: string | undefined;
          try {
            const svc = await getWorkspaceDbService();
            try {
              // user_id is derived inside createTaskRun (getCurrentUserId);
              // the field on the type is not actually read from the arg.
              const run = await svc.createTaskRun({
                user_id: '',
                task_slug: 'agent',
                status: 'running',
                input: { instruction, mode },
              } as unknown as Parameters<typeof svc.createTaskRun>[0]);
              runId = run.id;
            } catch (err) {
              log.warn('could not open a task_run for the agent', { message: (err as Error).message });
            }

            const result = await runAgent({
              instruction, mode, projectRoot,
              onProgress: emit,
              isCancelled: () => cancelled,
            });

            if (runId) {
              await svc.updateTaskRunStatus(
                runId,
                result.stopReason === 'done' ? 'completed' : result.stopReason === 'cancelled' ? 'cancelled' : 'failed',
                {
                  answer: result.answer,
                  playbook: result.playbook,
                  steps: result.steps,
                  stopReason: result.stopReason,
                  toolCalls: result.toolCalls,
                },
                result.error,
              ).catch(() => undefined);
            }

            return {
              id, runId,
              answer: result.answer,
              stopReason: result.stopReason,
              steps: result.steps,
              toolCalls: result.toolCalls,
              playbook: result.playbook,
              error: result.error,
            };
          } finally {
            releaseAgentSlot(id);
          }
        }

        default:
          throw new Error(`نامعلوم agent عمل: ${payload?.action}`);
      }
    },
  );
}
