/**
 * M13 Phase 0 — per-write approval for files outside the project (ADR-0056).
 *
 * Same request/resolve shape as `planApproval.ts`, but keyed per request (a
 * run may ask several times) and fired in Auto mode too: plan-level approval
 * never covers an edit to the scholar's own files elsewhere on the machine.
 * Always resolves — a timeout or a closed window resolves to 'rejected'.
 */
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { logger } from '../lib/logger.js';
import { ALLOWED_IPC_CHANNELS } from '../ipc/registry.js';

const log = logger.child('agent/fileApproval');

export interface FileApprovalRequest {
  /** Absolute path of the file to be changed (or the destination folder for organize_files). */
  path: string;
  /** Human-readable list of what will happen, one entry per step. */
  ops: string[];
  /** The sibling `.bak` that will be made first, when applicable. */
  backup?: string;
  /** The tool asking — for the card's heading. */
  tool: string;
}

interface Pending {
  resolve: (d: 'approved' | 'rejected') => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

/** Show the approval card in the renderer and wait for the scholar's decision. */
export function requestFileApproval(
  runId: string,
  req: FileApprovalRequest,
  sender: WebContents | null | undefined,
): Promise<'approved' | 'rejected'> {
  if (!sender || sender.isDestroyed()) return Promise.resolve('rejected');
  const requestId = `fa_${randomUUID().slice(0, 12)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      log.warn('file approval timed out', { runId, requestId });
      resolve('rejected');
    }, APPROVAL_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    sender.send(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, {
      id: runId,
      kind: 'file-approval-pending',
      requestId,
      label: 'approve the change to a file outside the project',
      labelKey: 'agent.step.file_approval_pending',
      fileApproval: { requestId, ...req },
    });
  });
}

/** Called by the `approveFileWrite` IPC action. Unknown/expired ids are ignored. */
export function resolveFileApproval(requestId: string, decision: 'approved' | 'rejected'): void {
  const p = pending.get(requestId);
  if (!p) { log.debug('file approval for an unknown / expired request', { requestId }); return; }
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(decision);
}
