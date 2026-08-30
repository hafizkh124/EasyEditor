/**
 * Desktop document bridge — IPC handlers (SPEC-M8 Layer 1–3 / P1–P3).
 *
 * One `DOC_BRIDGE_INVOKE` channel with an action switch (the Shamela/Tafsir
 * pattern). P1: `detectTools` / `ping`. P2: the Word adapter operations.
 * P3: `word:plan` (loss list, no execution), `word:export` (run a conversion
 * from the editor's HTML through a native save dialog), `openPath`.
 *
 * The renderer never spawns PowerShell — everything goes through the main
 * process, and the op protocol (electron/host/wordBridge.ps1) never
 * interpolates caller input into a script string.
 */
import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { detectTools, pingHost } from '../host/index.js';
import * as word from '../adapters/word.js';
import { planConversion } from '../../shared/convert/planner.js';
import type { DocFormat } from '../../shared/adapters/types.js';

const EXPORT_TARGETS = {
  docx: { ext: 'docx', label: 'Word Document' },
  pdf: { ext: 'pdf', label: 'PDF' },
  rtf: { ext: 'rtf', label: 'Rich Text Format' },
  txt: { ext: 'txt', label: 'Plain Text' },
} as const;
type ExportTarget = keyof typeof EXPORT_TARGETS;

function sanitizeFilename(name: string): string {
  return (name || 'document').replace(/[^\p{L}\p{N} ._-]/gu, '_').trim() || 'document';
}

export function registerDocBridgeHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE,
    async (event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload?.action) {
        // ── P1 ────────────────────────────────────────────────────────
        case 'detectTools':
          return detectTools();

        case 'ping':
          return pingHost();

        // ── P2: Word adapter ──────────────────────────────────────────
        case 'word:descriptor':
          return { descriptor: word.wordDescriptor, availability: word.available() };

        case 'word:toWord':
          return word.toWord(
            payload.input as { sourcePath?: string; html?: string },
            String(payload.outputPath),
            (payload.options as word.ToWordOptions) ?? {},
          );

        case 'word:fromWord':
          return word.fromWord(
            String(payload.sourcePath),
            payload.to as 'pdf' | 'rtf' | 'html' | 'txt',
            String(payload.outputPath),
          );

        case 'word:reflowPdf': {
          const win = BrowserWindow.fromWebContents(event.sender);
          return word.reflowPdf(String(payload.pdfPath), String(payload.outputPath), (p) => {
            win?.webContents.send(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_PROGRESS, { op: 'reflowPdf', ...p });
          });
        }

        case 'word:readStructure':
          return word.readStructure(String(payload.docxPath));

        case 'word:installFont':
          return word.installFont(String(payload.fontPath));

        // ── P3: convert dialog ────────────────────────────────────────
        case 'word:plan': {
          const from = payload.from as DocFormat;
          const to = payload.to as DocFormat;
          return planConversion({ from, to, adapters: [word.wordDescriptor] });
        }

        case 'word:export': {
          const to = payload.to as ExportTarget;
          const target = EXPORT_TARGETS[to];
          if (!target) throw new Error(`unsupported export target: ${payload.to}`);

          const plan = planConversion({ from: 'html', to, adapters: [word.wordDescriptor] });
          if (!plan.ok) throw new Error(plan.reason);

          const suggested = `${sanitizeFilename(String(payload.title ?? 'document'))}.${target.ext}`;
          const { canceled, filePath } = await dialog.showSaveDialog({
            defaultPath: suggested,
            filters: [{ name: target.label, extensions: [target.ext] }],
          });
          if (canceled || !filePath) return { cancelled: true as const };

          const win = BrowserWindow.fromWebContents(event.sender);
          win?.webContents.send(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_PROGRESS, { op: 'export', phase: 'converting', percent: 20 });
          const res = await word.exportDocument(
            { html: String(payload.html ?? '') },
            to,
            filePath,
            (payload.options as word.ToWordOptions) ?? {},
          );
          win?.webContents.send(ALLOWED_IPC_CHANNELS.DOC_BRIDGE_PROGRESS, { op: 'export', phase: 'done', percent: 100 });

          return { cancelled: false as const, outputPath: res.outputPath, losses: plan.losses, ms: res.ms };
        }

        case 'openPath': {
          const p = path.resolve(String(payload.path));
          const err = await shell.openPath(p);
          if (err) throw new Error(err);
          return { opened: true };
        }

        default:
          throw new Error(`نامعلوم docbridge عمل: ${payload?.action}`);
      }
    },
  );
}
