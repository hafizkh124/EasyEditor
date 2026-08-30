import { app, BrowserWindow, shell, session, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSystemHandlers } from './ipc/systemHandlers.js';
import { registerAiHandlers } from './ipc/aiHandlers.js';
import { registerWorkspaceHandlers } from './ipc/workspaceHandlers.js';
import { registerShamelaHandlers } from './ipc/shamelaHandlers.js';
import { registerTafsirHandlers } from './ipc/tafsirHandlers.js';
import { terminateLocalSync } from './tafsir/mcpClient.js';
import { registerVoiceHandlers } from './ipc/voiceHandlers.js';
import { registerDocBridgeHandlers } from './ipc/docBridgeHandlers.js';
import { initDocBridge, shutdownDocBridgeSync } from './host/index.js';
import { registerFsHandlers, terminateFsWatch } from './ipc/fsHandlers.js';
import { registerAgentHandlers } from './ipc/agentHandlers.js';
import { isAllowedExternalUrl } from './lib/urlAllowlist.js';
import { ALLOWED_IPC_CHANNELS } from './ipc/registry.js';
import { logger } from './lib/logger.js';

const log = logger.child('main');

function openExternalSafely(rawUrl: string): void {
  const parsed = isAllowedExternalUrl(rawUrl);
  if (!parsed) return;
  void shell.openExternal(parsed.toString());
}

/**
 * The project's Supabase origin, substituted at build time by the `define` map
 * in vite.config.ts (the electron entries get their own copy — this build does
 * not inherit the renderer's). Kept as an origin, not a full URL, because that
 * is the form both the CSP and the external-URL allowlist want.
 */
const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).origin;
  } catch {
    // Never let a missing/garbled URL take the whole app down at startup — the
    // app is offline-first, so the worst case is that optional sign-in is
    // blocked by CSP, exactly as it was before this origin was added.
    return '';
  }
})();

/**
 * Custom scheme for the OAuth round trip (SPEC-M5 revision, 2026-08-08).
 *
 * The desktop app is loaded from `file://`, so it has no origin an OAuth
 * provider can redirect back to, and Google refuses to authenticate inside an
 * embedded window anyway. The standard answer is the one used here: open the
 * consent page in the user's real browser, and have the provider redirect to a
 * private scheme the OS hands back to this app.
 */
const APP_PROTOCOL = 'easyeditor';

/**
 * Deliver an `easyeditor://` callback to the renderer, which owns the Supabase
 * client and completes the session. Main deliberately does not parse the
 * tokens: it forwards the URL and nothing else.
 */
function forwardDeepLink(rawUrl: string): void {
  if (!rawUrl.startsWith(`${APP_PROTOCOL}://`)) return;
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  mainWindow.webContents.send(ALLOWED_IPC_CHANNELS.AUTH_DEEP_LINK, rawUrl);
}

/** Pick the deep link out of a process argv (Windows/Linux delivery route). */
function deepLinkFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${APP_PROTOCOL}://`));
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
nativeTheme.themeSource = 'system';

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

  // A failed preload script leaves `window.electronAPI` undefined with no
  // other signal — every desktop-only feature (workspace DB, desktop OAuth,
  // voice, Shamela) then fails at its own call site with a generic error,
  // and nothing points back here. Surface it loudly instead.
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    log.error('preload script failed to load', { preloadPath, message: error.message, stack: error.stack });
  });

  // Security: CSP Header injection (SPEC-M5 FR-2.2/NFR-11).
  // connect-src is a named list, never a bare `https:` — local mode's privacy
  // premise is "no network request the user did not ask for", and a wildcard
  // here would let that promise slip silently. Two hosts are named:
  //   • Google's Gemini endpoint — the BYOK AI path.
  //   • The project's own Supabase origin — needed only for the OPTIONAL
  //     in-app sign-in and the cloud features behind it. Without it the browser
  //     blocks every auth call before it leaves the renderer, so the sign-in
  //     dialog can only ever fail. Nothing contacts this host until the user
  //     opts in; the workspace itself stays entirely local.
  // Still no 'unsafe-eval' and no remote script/style/font sources (FR-2.2).
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
          `connect-src 'self' https://generativelanguage.googleapis.com ${SUPABASE_ORIGIN}; ` +
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

// ── OAuth deep-link plumbing ────────────────────────────────────────────────
//
// Windows and Linux deliver `easyeditor://…` by launching a SECOND copy of the
// app with the URL in argv. Without a single-instance lock that copy would open
// its own window (and its own SQLite handle) and the first one would never hear
// about the callback. So: take the lock, and let the second copy hand its argv
// to the running instance and exit. macOS instead fires `open-url` on the
// existing process, so both routes are wired.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) {
      forwardDeepLink(link);
      return;
    }
    // Plain re-launch (user double-clicked the icon again): surface the window
    // that already exists rather than leaving them staring at nothing.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    forwardDeepLink(url);
  });

  /**
   * Ships updates without asking the user to hunt for an installer.
   *
   * This is the one network call the app makes that the user did not initiate,
   * which sits in tension with local mode's "no request you did not ask for"
   * premise — so it is deliberately narrow: it runs only in a packaged build
   * (never in dev, where there is no update feed), it talks only to the GitHub
   * releases endpoint declared in package.json `build.publish`, and it carries
   * no user data. A failed check is not worth a dialog: an offline scholar is
   * the expected case here, not an error.
   */
  function checkForUpdates(): void {
    if (!app.isPackaged) return;
    void import('electron-updater')
      .then(({ autoUpdater }) => {
        autoUpdater.logger = null;
        return autoUpdater.checkForUpdatesAndNotify();
      })
      .catch(() => {
        /* offline, rate-limited, or no release yet — all non-events */
      });
  }

  app.whenReady().then(() => {
    // In dev the executable is Electron itself, so the OS needs the path to the
    // app entry as well or it registers the wrong command for the scheme.
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(APP_PROTOCOL);
    }

    setupApplicationMenu();
    registerSystemHandlers();
    registerAiHandlers();
    registerWorkspaceHandlers();
    registerShamelaHandlers();
    registerTafsirHandlers();
    registerVoiceHandlers();
    registerDocBridgeHandlers();
    registerFsHandlers();
    registerAgentHandlers();
    createWindow();
    checkForUpdates();

    // M8 Layer 1: clean up a WINWORD.EXE a previous hard-killed run may have
    // left orphaned (P0 proof 6). Windows-only; a no-op elsewhere.
    void initDocBridge().catch((err) => {
      log.warn('doc-bridge startup sweep failed', { message: (err as Error).message });
    });

    // Cold start FROM a deep link (the app was not running when the browser
    // handed the callback over). The renderer is not listening yet, so wait for
    // it to finish loading before sending.
    const initialLink = deepLinkFromArgv(process.argv);
    if (initialLink) {
      mainWindow?.webContents.once('did-finish-load', () => forwardDeepLink(initialLink));
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

// No zombie subprocesses left behind. `before-quit` does not await promises,
// so both of these are synchronous child kills:
//   - `uvx tafsir-mcp` / python sidecar (SPEC-TAFSIR §FR-3.3)
//   - the PowerShell host AND any WINWORD.EXE it owns (SPEC-M8 §6 constraint 1 /
//     P0 proof 6 — Word does not exit on its own when its automator dies)
app.on('before-quit', () => {
  terminateLocalSync();
  shutdownDocBridgeSync();
  terminateFsWatch();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
