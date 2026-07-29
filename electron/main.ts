import { app, BrowserWindow, shell, session, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSystemHandlers } from './ipc/systemHandlers.js';
import { registerAiHandlers } from './ipc/aiHandlers.js';
import { registerWorkspaceHandlers } from './ipc/workspaceHandlers.js';
import { registerShamelaHandlers } from './ipc/shamelaHandlers.js';
import { registerVoiceHandlers } from './ipc/voiceHandlers.js';

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
        { label: 'مکمل اسکرین (Toggle Full Screen)', role: 'toggleDevTools' },
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

  // Security: CSP Header injection
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https: wss:;",
        ],
      },
    });
  });

  // Intercept new window requests and open externally in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block unexpected navigation
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl);
    if (parsedUrl.origin !== (process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL).origin : 'file://')) {
      event.preventDefault();
      shell.openExternal(navigationUrl);
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
  registerVoiceHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
