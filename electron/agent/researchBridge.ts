/**
 * M9 Phase 1 — the renderer bridge for the research channels (generalises
 * M8's `generalSearch.ts`, ADR-0019 item 7 / ADR-0022).
 *
 * The agent loop runs in the main process, but the research edge functions
 * (`research-query` for the General channel, `islamic-search` for the grounded
 * Islamic channel) are signed-in Supabase functions the RENDERER calls. The
 * main process asks the renderer to run the query (over AGENT_PROGRESS, with
 * `kind: 'general-search-request'` and a `mode`) and waits for the reply on the
 * `generalSearchResult` IPC action.
 *
 * The Islamic channel additionally returns page-precise `citations`, so unlike
 * the General channel its results CAN become a footnote source.
 */
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { logger } from '../lib/logger.js';
import { ALLOWED_IPC_CHANNELS } from '../ipc/registry.js';
import type { CitationItem } from '../../shared/research/citationTypes.js';

const log = logger.child('agent/researchBridge');

export type ResearchMode = 'general' | 'islamic';

export interface ResearchResult {
  answer?: string;
  channel?: string;
  error?: string;
  /** Islamic channel only — page-precise, citable. */
  citations?: CitationItem[];
}

interface Pending {
  resolve: (r: ResearchResult) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * Ask the renderer to run one research query. Always resolves — a timeout
 * resolves to a clear error, never rejects.
 */
export function requestResearch(
  runId: string,
  query: string,
  sender: WebContents | null | undefined,
  mode: ResearchMode = 'general',
): Promise<ResearchResult> {
  if (!sender || sender.isDestroyed()) {
    return Promise.resolve({ error: 'Research is unavailable — the app window is gone.' });
  }
  const requestId = randomUUID();
  return new Promise<ResearchResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      log.warn('research request timed out', { requestId, mode });
      resolve({ error: 'The research channel needs an internet connection and a signed-in session — it did not respond.' });
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, timer });
    sender.send(ALLOWED_IPC_CHANNELS.AGENT_PROGRESS, {
      id: runId,
      kind: 'general-search-request',
      requestId,
      query,
      mode,
    });
  });
}

/** Called by the `generalSearchResult` IPC action when the renderer replies. */
export function resolveResearch(requestId: string, result: ResearchResult): void {
  const p = pending.get(requestId);
  if (!p) {
    log.debug('research result for an unknown / expired request', { requestId });
    return;
  }
  clearTimeout(p.timer);
  pending.delete(requestId);
  p.resolve(result);
}
