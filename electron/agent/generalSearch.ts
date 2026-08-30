/**
 * M8 Layer 6 — the renderer bridge for `search_general` (SPEC-M8 §3, ADR-0019
 * item 7 — "no open Browser tool").
 *
 * The agent loop runs in the main process, but the General research channel
 * (`research-query`) is a signed-in Supabase edge function the RENDERER calls.
 * So the main process asks the renderer to run the search (over AGENT_PROGRESS,
 * with `kind: 'general-search-request'`) and waits for the answer to come back
 * through the `generalSearchResult` IPC action. Offline / no session → the
 * renderer reports the error and the tool returns it plainly.
 */
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { logger } from '../lib/logger.js';
import { ALLOWED_IPC_CHANNELS } from '../ipc/registry.js';

const log = logger.child('agent/generalSearch');

export interface GeneralSearchResult {
  answer?: string;
  channel?: string;
  error?: string;
}

interface Pending {
  resolve: (r: GeneralSearchResult) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Ask the renderer to run one General-channel search. `runId` is the agent
 * run's id (so the renderer knows which run asked). Always resolves — a
 * timeout resolves to a clear "needs a connection" error, never rejects.
 */
export function requestGeneralSearch(
  runId: string,
  query: string,
  sender: WebContents | null | undefined,
): Promise<GeneralSearchResult> {
  if (!sender || sender.isDestroyed()) {
    return Promise.resolve({ error: 'General search is unavailable — the app window is gone.' });
  }
  const requestId = randomUUID();
  return new Promise<GeneralSearchResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      log.warn('general search timed out', { requestId });
      resolve({ error: 'General search needs an internet connection and a signed-in session — it did not respond.' });
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    sender.send(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, {
      id: runId,
      kind: 'general-search-request',
      requestId,
      query,
    });
  });
}

/** Called by the `generalSearchResult` IPC action when the renderer replies. */
export function resolveGeneralSearch(requestId: string, result: GeneralSearchResult): void {
  const p = pending.get(requestId);
  if (!p) {
    log.debug('general search result for an unknown / expired request', { requestId });
    return;
  }
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(result);
}
