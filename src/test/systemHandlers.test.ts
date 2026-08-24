// @vitest-environment node
// electron/ipc/systemHandlers.ts — small, but SYSTEM_OPEN_EXTERNAL is a
// security boundary in its own right (SPEC-M5 FR-2.2): it is the second of
// two call sites that must agree on isAllowedExternalUrl (the other is
// electron/main.ts's window-open/navigation interception), and
// urlAllowlist.test.ts already proves that function correct in isolation —
// this file proves the IPC wiring around it doesn't add a bypass, e.g. by
// forgetting the type check on a value that arrived over IPC as `unknown`,
// not as the `string` the signature claims.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { createElectronMock } from "./helpers/electronMock";

// No `vi.hoisted` needed: unlike the Supabase fakes, this mock has nothing to
// coordinate with a hoisted `vi.mock` factory body — `vi.mock`'s factory is
// invoked lazily on first import of "electron", not eagerly at hoist time, so
// it can safely close over a plain top-level const declared above it.
const electron = createElectronMock();
vi.mock("electron", () => electron);

let mod: typeof import("../../electron/ipc/systemHandlers.ts");

beforeAll(async () => {
  mod = await import("../../electron/ipc/systemHandlers.ts");
  mod.registerSystemHandlers();
});

describe("registration", () => {
  it("registers all four documented channels", () => {
    expect([...electron.ipcMain.handlers.keys()].sort()).toEqual([
      "system:get-version",
      "system:is-desktop",
      "system:open-external",
      "system:set-title",
    ]);
  });
});

describe("system:get-version / system:is-desktop", () => {
  it("returns the app's real version string", () => {
    electron.app.getVersion.mockReturnValue("2.0.0");
    expect(electron.invoke("system:get-version")).toBe("2.0.0");
  });

  it("always reports desktop mode true — this handler only exists on desktop", () => {
    expect(electron.invoke("system:is-desktop")).toBe(true);
  });
});

describe("system:open-external — the security boundary", () => {
  it("opens an allowlisted https URL and reports success", async () => {
    electron.shell.openExternal.mockClear();
    const result = await electron.invoke("system:open-external", "https://shamela.ws/book/1");
    expect(result).toBe(true);
    expect(electron.shell.openExternal).toHaveBeenCalledWith("https://shamela.ws/book/1");
  });

  it.each([
    "https://evil.example.com",
    "http://shamela.ws/downgrade",
    "file:///C:/Windows/System32",
    "javascript:alert(1)",
    "https://shamela.ws.evil.com/spoof",
  ])("refuses %s and reports failure without touching shell.openExternal", async (url) => {
    electron.shell.openExternal.mockClear();
    const result = await electron.invoke("system:open-external", url);
    expect(result).toBe(false);
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  it("does not throw when the IPC payload is not a string at all", async () => {
    // The signature claims `url: string`, but nothing enforces that across an
    // IPC boundary — a compromised or buggy renderer can send anything.
    for (const bad of [null, undefined, 42, {}, []] as unknown[]) {
      electron.shell.openExternal.mockClear();
      await expect(electron.invoke("system:open-external", bad)).resolves.toBe(false);
      expect(electron.shell.openExternal).not.toHaveBeenCalled();
    }
  });
});

describe("system:set-title", () => {
  it("sets the title on the focused window when one exists", async () => {
    const setTitle = vi.fn();
    electron.BrowserWindow.getFocusedWindow.mockReturnValue({ setTitle });
    await electron.invoke("system:set-title", "New Title");
    expect(setTitle).toHaveBeenCalledWith("New Title");
  });

  it("does not throw when there is no focused window", async () => {
    electron.BrowserWindow.getFocusedWindow.mockReturnValue(null);
    await expect(electron.invoke("system:set-title", "New Title")).resolves.toBeUndefined();
  });
});
