/**
 * Desktop document bridge — IPC handlers (SPEC-M8 Layer 1–2 / P1–P2).
 *
 * One `DOC_BRIDGE_INVOKE` channel with an action switch (the Shamela/Tafsir
 * pattern). P1 shipped `detectTools` / `ping`; P2 adds the Word adapter
 * operations. The renderer never spawns PowerShell — everything goes through
 * the main process, and the op protocol (electron/host/wordBridge.ps1) never
 * interpolates caller input into a script string.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { detectTools, pingHost } from '../host/index.js';
import * as word from '../adapters/word.js';

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

        default:
          throw new Error(`نامعلوم docbridge عمل: ${payload?.action}`);
      }
    },
  );
}
