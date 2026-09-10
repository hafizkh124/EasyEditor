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
import { runBatch } from '../agent/batch.js';
import { undoCheckpoint, listCheckpoints } from '../agent/checkpoint.js';
import { applyGlobalOption, revertGlobalOptions, readLog as readGlobalOptionLog } from '../agent/globalOptions.js';
import { requestGeneralSearch, resolveGeneralSearch } from '../agent/generalSearch.js';
import { requestResearch, requestTranscription, resolveTranscription } from '../agent/researchBridge.js';
import { requestOcr, resolveOcr } from '../agent/ocrBridge.js';
import { setOcrConsent } from '../fs/projectFolder.js';
import { requestPlanApproval, resolvePlanApproval } from '../agent/planApproval.js';
import { acquireAgentSlot, releaseAgentSlot, cancelRunningAgent, runningTask } from '../agent/queue.js';
import type { AgentMode } from '../../shared/agent/types.js';
import { getWorkspaceDbService } from './workspaceHandlers.js';
import type { AgentProgress } from '../../shared/agent/types.js';
import type { CitationItem } from '../../shared/research/citationTypes.js';

type ResearchResultCitations = CitationItem[];

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

        case 'checkpoints':
          return { checkpoints: listCheckpoints(String(payload.projectRoot ?? '')) };

        case 'undoTask': {
          const root = String(payload.projectRoot ?? '');
          const checkpointId = String(payload.checkpointId ?? '');
          if (!root || !checkpointId) throw new Error('projectRoot and checkpointId are required');
          if (runningTask()) throw new Error('ایک ایجنٹ ٹاسک چل رہا ہے — پہلے اسے مکمل ہونے دیں');
          return undoCheckpoint(root, checkpointId);
        }

        // ── P9: consent-gated Word global options (§3 gate #5) ──────────
        case 'applyGlobalOption': {
          const root = String(payload.projectRoot ?? '');
          if (!root) throw new Error('projectRoot is required');
          if (runningTask()) throw new Error('ایک ایجنٹ ٹاسک چل رہا ہے — پہلے اسے مکمل ہونے دیں');
          return applyGlobalOption(root, String(payload.option ?? ''), String(payload.value ?? ''));
        }

        case 'revertGlobalOptions': {
          const root = String(payload.projectRoot ?? '');
          if (!root) throw new Error('projectRoot is required');
          if (runningTask()) throw new Error('ایک ایجنٹ ٹاسک چل رہا ہے — پہلے اسے مکمل ہونے دیں');
          return revertGlobalOptions(root);
        }

        case 'globalOptionLog':
          return { entries: readGlobalOptionLog(String(payload.projectRoot ?? '')) };

        // ── M9: the renderer's reply to a Plan-mode approval request (ADR-0026) ──
        case 'approvePlan': {
          resolvePlanApproval(
            String(payload.runId ?? ''),
            payload.decision === 'approved' ? 'approved' : 'rejected',
          );
          return { ok: true };
        }

        // ── M9 Phase 5: the renderer's reply to a transcription request ──
        case 'transcriptionResult': {
          resolveTranscription(String(payload.requestId ?? ''), {
            segments: Array.isArray(payload.segments)
              ? payload.segments as Array<{ start: number; end: number; text: string }>
              : undefined,
            error: typeof payload.error === 'string' ? payload.error : undefined,
          });
          return { ok: true };
        }

        // ── M9 Phase 7: consent-gated cloud OCR (ADR-0023) ──────────────
        case 'grantOcrConsent': {
          const root = String(payload.projectRoot ?? '');
          if (!root) throw new Error('projectRoot is required');
          return { ocrConsent: setOcrConsent(root, payload.granted !== false) };
        }

        case 'ocrResult': {
          resolveOcr(String(payload.requestId ?? ''), {
            pages: Array.isArray(payload.pages)
              ? payload.pages as Array<{ page: number; text: string }>
              : undefined,
            error: typeof payload.error === 'string' ? payload.error : undefined,
          });
          return { ok: true };
        }

        // ── P9 / M9: the renderer's reply to a research request (ADR-0019 #7, ADR-0022) ──
        case 'generalSearchResult': {
          resolveGeneralSearch(String(payload.requestId ?? ''), {
            answer: typeof payload.answer === 'string' ? payload.answer : undefined,
            channel: typeof payload.channel === 'string' ? payload.channel : undefined,
            error: typeof payload.error === 'string' ? payload.error : undefined,
            citations: Array.isArray(payload.citations) ? payload.citations as ResearchResultCitations : undefined,
          });
          return { ok: true };
        }

        case 'run': {
          const instruction = String(payload.instruction ?? '').trim();
          const mode: AgentMode =
            payload.mode === 'auto' || payload.mode === 'do' ? 'auto'
            : payload.mode === 'plan' ? 'plan'
            : 'ask';
          const projectRoot = String(payload.projectRoot ?? '');
          if (!instruction) throw new Error('instruction is required');
          if (!projectRoot) throw new Error('open a project folder first');

          // Plan §4.4 — validate the optional structured scope.
          const rawScope = (payload.scope && typeof payload.scope === 'object' ? payload.scope : null) as
            | { books?: unknown; groups?: unknown; playbook?: unknown; mentions?: unknown; batch?: unknown }
            | null;
          const scope = rawScope
            ? {
                books: Array.isArray(rawScope.books) ? (rawScope.books as unknown[]).filter((x): x is string => typeof x === 'string') : [],
                groups: Array.isArray(rawScope.groups)
                  ? (rawScope.groups as Array<Record<string, unknown>>)
                      .filter((g) => g && typeof g.ref === 'string' && Array.isArray(g.bookRefs))
                      .map((g) => ({ type: String(g.type ?? ''), ref: String(g.ref), label: String(g.label ?? ''), bookRefs: (g.bookRefs as unknown[]).filter((x): x is string => typeof x === 'string') }))
                  : [],
                playbook: typeof rawScope.playbook === 'string' ? rawScope.playbook : null,
                mentions: Array.isArray(rawScope.mentions) ? (rawScope.mentions as unknown[]).filter((x): x is string => typeof x === 'string') : [],
                batch:
                  rawScope.batch && typeof rawScope.batch === 'object' && 'granularity' in rawScope.batch
                    ? {
                        granularity: (rawScope.batch as { granularity: string }).granularity === 'per-author' ? ('per-author' as const) : ('per-book' as const),
                        resumeFrom: typeof (rawScope.batch as Record<string, unknown>).resumeFrom === 'string' ? (rawScope.batch as Record<string, string>).resumeFrom : undefined,
                      }
                    : null,
              }
            : null;

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

            const runOpts = {
              instruction, mode, projectRoot,
              scope: scope ?? undefined,
              onProgress: emit,
              isCancelled: () => cancelled,
              generalSearch: (query: string) => requestGeneralSearch(id, query, win?.webContents),
              researchSearch: (m: 'general' | 'islamic', query: string) => requestResearch(id, query, win?.webContents, m),
              transcribeMedia: (mediaPath: string, lang: string) => requestTranscription(id, mediaPath, lang, win?.webContents),
              ocrDocument: (scanPath: string, lang: string, pages?: string) => requestOcr(id, scanPath, lang, pages, win?.webContents),
              waitForApproval: (plan: { steps: string[]; summary: string }) => requestPlanApproval(id, plan, win?.webContents),
            } as Parameters<typeof runAgent>[0];

            const result =
              scope?.batch
                ? await runBatch(runOpts, scope, { onProgress: emit, isCancelled: () => cancelled, resumeFrom: scope.batch?.resumeFrom })
                : await runAgent(runOpts);

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
              checkpointId: result.checkpointId,
              question: result.question,
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
