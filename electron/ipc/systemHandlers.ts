import { ipcMain, shell, app, BrowserWindow } from 'electron';
import { ALLOWED_IPC_CHANNELS } from './registry.js';

export function registerSystemHandlers(): void {
  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_IS_DESKTOP, () => {
    return true;
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_event, url: string) => {
    // Only open HTTP/HTTPS URLs externally for security
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url);
      return true;
    }
    return false;
  });

  ipcMain.handle(ALLOWED_IPC_CHANNELS.SYSTEM_SET_TITLE, async (_event, title: string) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
      win.setTitle(title);
    }
  });
}
