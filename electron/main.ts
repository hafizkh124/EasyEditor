import { app, BrowserWindow, shell, session, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSystemHandlers } from './ipc/systemHandlers.js';
import { registerAiHandlers } from './ipc/aiHandlers.js';
import { registerWorkspaceHandlers } from './ipc/workspaceHandlers.js';
import { registerShamelaHandlers } from './ipc/shamelaHandlers.js';
import { registerTafsirHandlers } from './ipc/tafsirHandlers.js';
import { terminateLocalSync } from './tafsir/mcpClient.js';
import { registerVoiceHandlers } from './ipc/voiceHandlers.js';
import { isAllowedExternalUrl } from './lib/urlAllowlist.js';

function openExternalSafely(rawUrl: string): void {
  const parsed = isAllowedExternalUrl(rawUrl);
  if (!parsed) return;
  void shell.openExternal(parsed.toString());
}

function setupApplicationMenu(): void {
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'فائل (File)',
      submenu: [
        { label: 'بند کریں (Exit)', role: 'quit' },
      ],
    },
    {
      label: 'ایڈٹ (Edit)',
      submenu: [
        { label: 'کاپی (Copy)', role: 'copy' },
        { label: 'پیسٹ (Paste)', role: 'paste' },
        { label: 'کٹ (Cut)', role: 'cut' },
        { label: 'سب منتخب کریں (Select All)', role: 'selectAll' },
      ],
    },
    {
      label: 'ویو (View)',
      submenu: [
        { label: 'دوبارہ لوڈ کریں (Reload)', role: 'reload' },
        { label: 'مکمل اسکرین (Toggle Full Screen)', role: 'togglefullscreen' },
        // DevTools stays out of the production menu entirely — a released
        // build should not offer an inspector as a first-class menu item.
        ...(process.env.VITE_DEV_SERVER_URL
          ? [{ label: 'ڈویلپر ٹولز (DevTools)', role: 'toggleDevTools' as const }]
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Disable hardware acceleration issues on some Windows systems if needed
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'العُلَمَاء Easy Editor',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#1e1e2e',
        symbolColor: '#cdd6f4',
        height: 36,
      },
    } : { titleBarStyle: 'default' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Security: CSP Header injection (SPEC-M5 FR-2.2/NFR-11).
  // connect-src is scoped to Google's Gemini endpoint only: local mode's
  // entire privacy premise is "no network request but Google" — a broad
  // `https:` here would silently let that promise slip. No 'unsafe-eval' or
  // remote script/style/font sources either ("no remote content" per FR-2.2).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "font-src 'self' data:; " +
          "img-src 'self' data: blob:; " +
          "connect-src 'self' https://generativelanguage.googleapis.com; " +
          "object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
        ],
      },
    });
  });

  // Intercept new window requests and open externally, allowlist-gated.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // Block unexpected navigation; anything leaving the app shell goes through
  // the same allowlist as an explicit external-open request.
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== (process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : 'file://')) {
      event.preventDefault();
      openExternalSafely(navigationUrl);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  setupApplicationMenu();
  registerSystemHandlers();
  registerAiHandlers();
  registerWorkspaceHandlers();
  registerShamelaHandlers();
  registerTafsirHandlers();
  registerVoiceHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// No zombie `uvx tafsir-mcp` / python subprocess left behind (SPEC-TAFSIR §FR-3.3).
// `before-quit` does not await promises, so this is a synchronous child kill.
app.on('before-quit', () => {
  terminateLocalSync();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
