/**
 * Desktop document bridge — IPC handlers (SPEC-M8 Layer 1 / P1).
 *
 * One `DOC_BRIDGE_INVOKE` channel with an action switch (the Shamela/Tafsir
 * pattern). P1 dispatches only `detectTools` and `ping`; the Word adapter
 * actions (`toWord`, `fromWord`, `convert`, `installFont`, …) land in P2 on
 * top of the same long-lived host.
 *
 * The renderer never spawns PowerShell — everything goes through the main
 * process, and the op protocol (electron/host/wordBridge.ps1) never
 * interpolates caller input into a script string.
 */
import { ipcMain } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { detectTools, pingHost } from '../host/index.js';

export function registerDocBridgeHandlers(): void {
  ipcMain.handle(
    ALLOWED_IPC_CHANNELS.DOC_BRIDGE_INVOKE,
    async (_event, payload: { action: string; [key: string]: unknown }) => {
      switch (payload?.action) {
        case 'detectTools':
          return detectTools();

        case 'ping':
          return pingHost();

        default:
          throw new Error(`نامعلوم docbridge عمل: ${payload?.action}`);
      }
    },
  );
}
