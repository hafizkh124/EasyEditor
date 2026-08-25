import { ipcMain, shell, app, BrowserWindow } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';
import { isAllowedExternalUrl } from '../lib/urlAllowlist.js';
import { logger } from '../lib/logger.js';

const log = logger.child('systemHandlers');

export function registerSystemHandlers(): void {
  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_IS_DESKTOP, () => {
    return true;
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_event, url: string) => {
    // SPEC-M5 FR-2.2: allowlisted https hosts only — same rule electron/main.ts
    // enforces for window-open and navigation interception.
    const parsed = typeof url === 'string' ? isAllowedExternalUrl(url) : null;
    if (!parsed) return false;
    try {
      await shell.openExternal(parsed.toString());
      return true;
    } catch (err) {
      log.error('shell.openExternal rejected', { err });
      return false;
    }
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_SET_TITLE, async (_event, title: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.setTitle(title);
    }
  });
}
