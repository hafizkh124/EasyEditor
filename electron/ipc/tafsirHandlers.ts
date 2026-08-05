/**
 * Tafsir MCP — IPC handlers (SPEC-TAFSIR §FR-4).
 *
 * One `TAFSIR_INVOKE` channel with an action switch (the Shamela pattern).
 * All renderer-safe actions are forwarded to the client core in the main
 * process; the renderer never learns the remote endpoint or calls MCP directly.
 */
import { ipcMain, app } from 'electron';
import path from 'node:path';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import {
  connectRemote,
  connectLocal,
  disconnect,
  listTools,
  ping,
  pingRemote,
  callTool,
} from '../tafsir/mcpClient.js';
import {
  getLocalRuntime,
  TAFSIR_DB_SIZE_MB,
} from '../tafsir/localRuntime.js';
import type { TafsirMode, TafsirDiagnostics, TafsirInstallStatus } from '../tafsir/types.js';

const RUNTIME = getLocalRuntime(path.join(app.getPath('userData'), 'tafsir'));

const MB = 1024 * 1024;

/** Single in-flight download; guards the install actions (§FR-3.2). */
let installAbort: AbortController | null = null;
let installState: TafsirInstallStatus = {
  state: 'idle',
  downloadedBytes: 0,
  totalBytes: TAFSIR_DB_SIZE_MB * MB,
  percent: 0,
};

export function registerTafsirHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.TAFSIR_INVOKE,
    async (_event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload.action) {
        case 'ping': {
          const mode = payload.mode === 'local' ? 'local' : 'remote';
          return mode === 'local' ? ping() : pingRemote();
        }

        case 'detect':
          return RUNTIME.detect();

        case 'diagnose': {
          const local = RUNTIME.detect();
          const remote = await pingRemote();
          const diag: TafsirDiagnostics = {
            ...local,
            remoteReachable: remote.ok,
            remoteLatencyMs: remote.latencyMs,
          };
          return diag;
        }

        case 'connect': {
          const mode = (payload.mode ?? 'remote') as TafsirMode;
          if (mode === 'local') {
            const det = RUNTIME.detect();
            if (!det.dbFound) {
              // Principle 5: never let `uvx tafsir-mcp` silently download ~214 MB.
              throw new Error('مقامی ڈیٹابیس موجود نہیں — پہلے ڈاؤن لوڈ کریں (install:start)۔');
            }
            const params = RUNTIME.buildStdioParams();
            if (!params) {
              throw new Error('مقامی tafsir-mcp چلانے کے لیے Python/uv نہیں ملا (تشخیص دیکھیں)۔');
            }
            return connectLocal(params);
          }
          return connectRemote();
        }

        case 'disconnect':
          await disconnect();
          return { disconnected: true };

        case 'tools':
          return listTools();

        case 'call': {
          const tool = String(payload.tool || '');
          const result = await callTool(tool, payload.arguments);
          return result;
        }

        case 'install:status':
          return installState;

        case 'install:start': {
          if (installState.state === 'downloading' || installState.state === 'verifying') {
            return installState;
          }
          const local = RUNTIME.detect();
          if (local.dbFound) {
            installState = {
              state: 'done',
              downloadedBytes: TAFSIR_DB_SIZE_MB * MB,
              totalBytes: TAFSIR_DB_SIZE_MB * MB,
              percent: 100,
            };
            return installState;
          }
          if (!local.pythonFound || !local.uvFound) {
            throw new Error('مقامی tafsir-mcp کے لیے Python/uv درکار ہے (تشخیص دیکھیں)۔');
          }

          installAbort = new AbortController();
          installState = {
            state: 'downloading',
            downloadedBytes: 0,
            totalBytes: TAFSIR_DB_SIZE_MB * MB,
            percent: 0,
          };
          const sender = _event.sender;
          try {
            await RUNTIME.downloadDatabase({
              signal: installAbort.signal,
              onProgress: (p) => {
                installState = {
                  state: p.state,
                  downloadedBytes: p.downloadedBytes,
                  totalBytes: p.totalBytes,
                  percent: p.percent,
                };
                sender.send(ALLOWED_IPC_CHANNELS.TAFSIR_INSTALL_PROGRESS, p);
              },
            });
            installState = {
              state: 'done',
              downloadedBytes: TAFSIR_DB_SIZE_MB * MB,
              totalBytes: TAFSIR_DB_SIZE_MB * MB,
              percent: 100,
            };
            return installState;
          } catch (err) {
            const aborted = installAbort?.signal.aborted ?? false;
            installState = aborted
              ? { state: 'idle', downloadedBytes: 0, totalBytes: TAFSIR_DB_SIZE_MB * MB, percent: 0 }
              : {
                  state: 'error',
                  downloadedBytes: 0,
                  totalBytes: TAFSIR_DB_SIZE_MB * MB,
                  percent: 0,
                  error: err instanceof Error ? err.message : 'ڈاؤن لوڈ ناکام۔',
                };
            if (aborted) return installState;
            throw err;
          } finally {
            installAbort = null;
          }
        }

        case 'install:cancel':
          installAbort?.abort();
          return { cancelled: true };

        default:
          throw new Error(`نامعلوم تصفیر عمل: ${payload.action}`);
      }
    },
  );
}