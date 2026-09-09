import { ipcMain, BrowserWindow } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { logger } from '../lib/logger.js';
import {
  detectJkhssnInstallation,
  diagnoseJkhssnInstallation,
  saveJkhssnPath,
  jkhssnDataPath,
} from '../jkhssn/jkhssnNative.js';
import { jkhssnIndexPath, closeJkhssnDb } from '../jkhssn/indexDb.js';
import { buildJkhssnIndex } from '../jkhssn/buildIndex.js';
import {
  axisSanadTree,
  axisNarrator,
  axisTakhrij,
  axisMatnCompare,
  axisJudgments,
  axisThematic,
  jkhssnFts,
  jkhssnSearchBooks,
} from '../jkhssn/axes.js';

const log = logger.child('jkhssn/handlers');

/** One index (re)build at a time. */
let rebuildSignal: { aborted: boolean } | null = null;

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

export function registerJkhssnHandlers(): void {
  ipcMain.handle(ALLOWED_IPC_CHANNELS.JKHSSN_INVOKE, async (event, payload: { action: string; [k: string]: unknown }) => {
    switch (payload.action) {
      case 'detect':
        return detectJkhssnInstallation();

      case 'diagnose':
        return diagnoseJkhssnInstallation();

      case 'savePath': {
        const p = str(payload.path);
        if (p) saveJkhssnPath(p);
        return detectJkhssnInstallation();
      }

      case 'cancelRebuild':
        if (rebuildSignal) rebuildSignal.aborted = true;
        return { cancelled: true };

      case 'rebuildIndex': {
        if (rebuildSignal) return { error: 'a rebuild is already running' };
        const dataPath = jkhssnDataPath();
        if (!dataPath) return { error: 'جوامع الكلم کا HadithDB فولڈر نہیں ملا' };
        const win = BrowserWindow.fromWebContents(event.sender);
        rebuildSignal = { aborted: false };
        try {
          const result = await buildJkhssnIndex({
            dataPath,
            outPath: jkhssnIndexPath(),
            withMatnComparison: payload.withMatnComparison === true,
            signal: rebuildSignal,
            onProgress: (p) => win?.webContents.send(ALLOWED_IPC_CHANNELS.JKHSSN_INDEX_PROGRESS, p),
          });
          closeJkhssnDb(); // force the read-only singleton to reopen the new file
          return { ok: true, rowCounts: result.rowCounts, skipped: result.skipped, elapsedMs: result.elapsedMs };
        } catch (err) {
          log.error('rebuild failed', { err: (err as Error).message });
          return { error: (err as Error).message };
        } finally {
          rebuildSignal = null;
        }
      }

      // ── the 6 axes ────────────────────────────────────────────────────────
      case 'axisSanadTree':
        return axisSanadTree({ hadithMainId: num(payload.hadithMainId), chainNodeId: num(payload.chainNodeId) });

      case 'axisNarrator':
        return axisNarrator({ rawyId: num(payload.rawyId), nameQuery: str(payload.nameQuery) });

      case 'axisTakhrij': {
        const id = num(payload.hadithMainId);
        return id != null ? axisTakhrij(id) : { error: 'hadithMainId required' };
      }

      case 'axisMatnCompare': {
        const g = num(payload.groupId);
        return g != null ? axisMatnCompare(g) : { error: 'groupId required' };
      }

      case 'axisJudgments': {
        const id = num(payload.hadithMainId);
        return id != null ? axisJudgments(id) : { error: 'hadithMainId required' };
      }

      case 'axisThematic':
        return axisThematic({ subjectId: num(payload.subjectId), query: str(payload.query) });

      case 'fts':
        return jkhssnFts(str(payload.query) ?? '', Array.isArray(payload.kinds) ? (payload.kinds as string[]) : [], num(payload.limit) ?? 30);

      case 'searchBooks':
        return jkhssnSearchBooks(str(payload.query) ?? '', num(payload.limit) ?? 6);

      default:
        throw new Error(`Unknown JKHSSN IPC action: ${String(payload.action)}`);
    }
  });
}

/** Sync cleanup for `app.on('before-quit')`. */
export function terminateJkhssn(): void {
  if (rebuildSignal) rebuildSignal.aborted = true;
  try { closeJkhssnDb(); } catch { /* ignore */ }
}
