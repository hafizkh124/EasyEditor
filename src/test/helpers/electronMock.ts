// A fake `electron` module for testing IPC handlers outside a real Electron
// process.
//
// `require('electron')` under plain Node (which is what Vitest runs on)
// resolves to the path of the electron.exe binary, not the real API — so any
// file that imports `electron` cannot be imported by a test at all without
// this. `createElectronMock()` returns a fresh, independent instance each
// call; wire it up per test file with:
//
//     const electron = createElectronMock();
//     vi.mock("electron", () => electron);
//
// No `vi.hoisted` here, deliberately: `vi.mock`'s factory is invoked lazily
// on first import of "electron" (when the module under test is dynamically
// imported in `beforeAll`), not eagerly at hoist time — unlike the Supabase
// fakes' `vi.mock` factories, which read per-test state through a `state`
// object that DOES need `vi.hoisted` because it is reassigned inside
// individual `it()` bodies, after the module has already loaded. Wrapping
// `createElectronMock()` itself in `vi.hoisted` fails: the hoisted callback
// runs before this file's own `import { createElectronMock }` line has
// initialized, throwing "Cannot access '...' before initialization".
import { vi } from "vitest";

export type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

export interface ElectronMock {
  ipcMain: {
    handle: (channel: string, fn: IpcHandler) => void;
    /** Every handler registered so far, keyed by channel. */
    handlers: Map<string, IpcHandler>;
  };
  shell: { openExternal: ReturnType<typeof vi.fn> };
  app: {
    getVersion: ReturnType<typeof vi.fn>;
    /** Defaults to throwing — tests that need a real path override this per file. */
    getPath: ReturnType<typeof vi.fn>;
    getAppPath: ReturnType<typeof vi.fn>;
  };
  BrowserWindow: {
    getFocusedWindow: ReturnType<typeof vi.fn>;
    fromWebContents: ReturnType<typeof vi.fn>;
  };
  dialog: { showSaveDialog: ReturnType<typeof vi.fn>; showOpenDialog: ReturnType<typeof vi.fn> };
  /** Convenience: invoke a registered handler with a fake IPC event. */
  invoke: (channel: string, ...args: unknown[]) => unknown;
}

export function createElectronMock(): ElectronMock {
  const handlers = new Map<string, IpcHandler>();

  const mock: ElectronMock = {
    ipcMain: {
      handlers,
      handle: (channel, fn) => {
        handlers.set(channel, fn);
      },
    },
    shell: { openExternal: vi.fn(async () => undefined) },
    app: {
      getVersion: vi.fn(() => "0.0.0-test"),
      getPath: vi.fn((key: string) => {
        throw new Error(`electronMock: app.getPath("${key}") has no default — set it in the test file`);
      }),
      getAppPath: vi.fn(() => process.cwd()),
    },
    BrowserWindow: {
      getFocusedWindow: vi.fn(() => null),
      fromWebContents: vi.fn(() => null),
    },
    dialog: {
      showSaveDialog: vi.fn(
        async (): Promise<{ canceled: boolean; filePath?: string }> => ({ canceled: true, filePath: undefined }),
      ),
      showOpenDialog: vi.fn(
        async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({ canceled: true, filePaths: [] }),
      ),
    },
    invoke: (channel, ...args) => {
      const fn = handlers.get(channel);
      if (!fn) throw new Error(`no handler registered for channel: ${channel}`);
      // Real ipcMain always passes an IpcMainInvokeEvent as the first
      // argument; { sender: null } is enough for handlers that only branch on
      // it via BrowserWindow.fromWebContents, which is itself mocked above.
      return fn({ sender: null }, ...args);
    },
  };

  return mock;
}
