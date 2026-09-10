/**
 * M9 ADR-0026 — Plan mode approval bridge.
 *
 * In Plan mode the agent lays out its steps and stops before the first write.
 * The main-process run waits here; the renderer replies with the `approvePlan`
 * IPC action (approved / rejected). Mirrors `generalSearch.ts`'s request/resolve
 * pattern. Always resolves — a timeout resolves to 'rejected', never rejects.
 */
import type { WebContents } from 'electron';
import { logger } from '../lib/logger.js';
import { ALLOWED_IPC_CHANNELS } from '../ipc/registry.js';

const log = logger.child('agent/planApproval');

interface Pending {
  resolve: (d: 'approved' | 'rejected') => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
const APPROVAL_TIMEOUT_MS = 10 * 60_000; // the scholar reads the plan at their own pace

/** Ask the renderer to show the plan and wait for the scholar's decision. */
export function requestPlanApproval(
  runId: string,
  plan: { steps: string[]; summary: string },
  sender: WebContents | null | undefined,
): Promise<'approved' | 'rejected'> {
  if (!sender || sender.isDestroyed()) return Promise.resolve('rejected');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(runId);
      log.warn('plan approval timed out', { runId });
      resolve('rejected');
    }, APPROVAL_TIMEOUT_MS);
    pending.set(runId, { resolve, timer });
    sender.send(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, {
      id: runId,
      kind: 'plan-pending',
      label: 'review the plan and approve it to continue',
      labelKey: 'agent.step.plan_pending',
      artifact: { op: 'open', artifactId: `plan-${runId}`, title: 'Proposed plan', artifactType: 'plan' },
    });
    sender.send(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, {
      id: runId,
      kind: 'plan-pending',
      artifact: { op: 'delta', artifactId: `plan-${runId}`, mode: 'replace', text: `${plan.summary}\n\n${plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` },
    });
  });
}

/** Called by the `approvePlan` IPC action when the renderer replies. */
export function resolvePlanApproval(runId: string, decision: 'approved' | 'rejected'): void {
  const p = pending.get(runId);
  if (!p) { log.debug('plan approval for an unknown / expired run', { runId }); return; }
  clearTimeout(p.timer);
  pending.delete(runId);
  p.resolve(decision);
}
