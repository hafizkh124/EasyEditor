/**
 * Connectors Hub — IPC handlers.
 *
 * One `CONNECTORS_INVOKE` channel with an action switch (the Shamela / Tafsir
 * pattern). The renderer never hard-codes the connector list — `list` returns
 * `CONNECTORS` plus the merged enable state; `ping` probes a connector keyed by
 * its `healthKind`; `setEnabled` flips the global or per-project switch.
 */
import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { logger } from '../lib/logger.js';
import { CONNECTORS, connectorById, mergeConnectorState } from '../../shared/agent/connectors.js';
import type { HealthResult } from '../../shared/connectors/health.js';
import { readGlobalConnectors, setGlobalConnector } from '../connectors/globalStore.js';
import { readConnectors, setConnector } from '../fs/projectFolder.js';
import { pingRemote } from '../tafsir/mcpClient.js';
import { detectShamelaInstallation } from '../shamela/shamelaNative.js';
import { pingCloud } from '../shamela/cloudClient.js';
import { GANJOOR_HEALTH_URL } from '../agent/adapters/ganjoor.js';

const log = logger.child('ipc/connectors');

/** Fixed health probes for `healthKind: 'http'` connectors (a cheap GET). */
const HEALTH_PROBE: Record<string, { url: string; headers?: Record<string, string> }> = {
  repositories: { url: 'https://archive.org/advancedsearch.php?q=title:test&rows=0&output=json' },
  ganjoor: { url: GANJOOR_HEALTH_URL },
  // NOTE: no `dorar` — dorar.net Cloudflare-blocks a standalone server probe
  // (403 on every path). `grade_hadith` goes through the research bridge; the
  // connector is `healthKind: 'bridged'` (ADR-0040 amended).
};

const HTTP_TIMEOUT_MS = 12_000;

async function probeHttp(id: string): Promise<HealthResult> {
  const probe = HEALTH_PROBE[id];
  if (!probe) return { ok: null, detail: 'no health endpoint configured' };
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(probe.url, { method: 'GET', signal: ctrl.signal, headers: probe.headers });
    if (res.status >= 400) return { ok: false, error: `HTTP ${res.status}`, detail: `server returned ${res.status}` };
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg, detail: 'could not reach the service — check your connection' };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(id: string): Promise<HealthResult> {
  const c = connectorById(id);
  if (!c) return { ok: false, error: `unknown connector: ${id}` };
  switch (c.healthKind) {
    case 'mcp': {
      if (id === 'tafsir') {
        const r = await pingRemote();
        return r.ok
          ? { ok: true, latencyMs: r.latencyMs }
          : { ok: false, error: r.error, detail: 'the MCP server did not respond' };
      }
      if (id === 'shamela-cloud') return pingCloud(); // never starts an interactive OAuth flow
      return { ok: null, detail: 'not connected' };
    }
    case 'http':
      return probeHttp(id);
    case 'local-native': {
      if (id === 'shamela') {
        const s = await detectShamelaInstallation();
        return s.installed
          ? { ok: true, detail: s.path ?? undefined }
          : { ok: false, error: s.reason, detail: s.reason ?? 'no local library found' };
      }
      return { ok: null, detail: 'not detected' };
    }
    case 'local-file':
      return { ok: null, detail: 'no index configured yet' };
    case 'bridged':
      return { ok: null, detail: 'checked at query time via your signed-in session' };
    case 'compute':
      return { ok: true, latencyMs: 0 };
    default:
      return { ok: null };
  }
}

export function registerConnectorsHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.CONNECTORS_INVOKE,
    async (_event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload.action) {
        case 'list': {
          const projectRoot = typeof payload.projectRoot === 'string' ? payload.projectRoot : null;
          const global = readGlobalConnectors();
          const project = projectRoot ? safeReadProject(projectRoot) : {};
          return {
            connectors: CONNECTORS,
            global,
            project,
            merged: mergeConnectorState(global, project),
          };
        }

        case 'setEnabled': {
          const id = String(payload.id ?? '');
          const on = payload.on === true;
          const scope = payload.scope === 'project' ? 'project' : 'global';
          if (scope === 'project') {
            const projectRoot = String(payload.projectRoot ?? '');
            if (!projectRoot) throw new Error('setEnabled scope:project needs a projectRoot');
            return { project: setConnector(projectRoot, id, on) };
          }
          return { global: setGlobalConnector(id, on) };
        }

        case 'ping': {
          const id = String(payload.id ?? '');
          return probe(id);
        }

        default:
          throw new Error(`unknown connectors action: ${payload.action}`);
      }
    },
  );
}

function safeReadProject(root: string): Record<string, boolean> {
  try {
    return readConnectors(root);
  } catch (err) {
    log.debug('readConnectors failed', { message: (err as Error).message });
    return {};
  }
}
