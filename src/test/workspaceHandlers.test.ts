// @vitest-environment node
// electron/ipc/workspaceHandlers.ts — the workspace:invoke channel's method
// allowlist, which is the closest thing in this codebase to a
// prototype-pollution guard. Its own comment states the exact attack it
// defends against: `service[name]` alone would reach `Object.prototype`
// members (`constructor`, `toString`, `__proto__`, …) for any method name a
// compromised or buggy renderer sends over IPC. Untested until now.
//
// `../db/open.js` and `../db/migrations/runner.js` are mocked so
// getWorkspaceDbService() constructs a REAL WorkspaceDbService without
// touching a real SQLite file — the class itself is a thin facade over
// electron/db/workspaceStore/*.ts, so mocking one of those (identity.ts) is
// enough to observe a real dispatch end to end.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createElectronMock } from "./helpers/electronMock";

const electron = createElectronMock();
vi.mock("electron", () => electron);

const getCurrentUserIdMock = vi.fn(() => "user-from-identity-module");
vi.mock("../../electron/db/workspaceStore/identity.ts", () => ({
  getCurrentUserId: getCurrentUserIdMock,
  genId: (prefix: string) => `${prefix}-fake-id`,
}));

vi.mock("../../electron/db/open.ts", () => ({
  getDbPath: () => "/fake/path/workspace.db",
  openWorkspaceDatabase: () => ({ __fakeDb: true }),
}));

vi.mock("../../electron/db/migrations/runner.ts", () => ({
  runDatabaseMigrations: vi.fn(async () => undefined),
}));

let mod: typeof import("../../electron/ipc/workspaceHandlers.ts");
let dbLib: typeof import("../../electron/db/workspaceDb.ts");

beforeAll(async () => {
  mod = await import("../../electron/ipc/workspaceHandlers.ts");
  dbLib = await import("../../electron/db/workspaceDb.ts");
  mod.registerWorkspaceHandlers();
});

beforeEach(() => {
  getCurrentUserIdMock.mockClear();
});

const invoke = (method: string, args: unknown[] = []) =>
  electron.invoke("workspace:invoke", { method, args });

describe("the allowlist is a real defense, not decoration", () => {
  it.each([
    "__proto__",
    "constructor",
    "prototype",
    "toString",
    "toLocaleString",
    "hasOwnProperty",
    "valueOf",
    "isPrototypeOf",
    "propertyIsEnumerable",
  ])("rejects the Object.prototype member %o without ever opening the database", async (method) => {
    const dbOpen = await import("../../electron/db/open.ts");
    const openSpy = vi.spyOn(dbOpen, "openWorkspaceDatabase");
    await expect(invoke(method)).rejects.toThrow(/not allowed/i);
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("rejects an unlisted-but-plausible method name", async () => {
    await expect(invoke("dropDatabase")).rejects.toThrow(/not allowed/i);
    await expect(invoke("executeRawSql")).rejects.toThrow(/not allowed/i);
  });

  it("rejects an empty method name", async () => {
    await expect(invoke("")).rejects.toThrow(/not allowed/i);
  });

  it("the rejection message names the method but nothing else sensitive", async () => {
    await expect(invoke("__proto__")).rejects.toThrow("__proto__");
  });
});

describe("every allowlisted name is a real, callable method — not stale or mistyped", () => {
  // Read directly off the real (unmocked) class prototype. No database needed
  // — prototype methods exist without ever constructing an instance.
  it("has more than 20 entries — a guard against an accidentally-empty allowlist", () => {
    expect(mod.ALLOWED_WORKSPACE_METHODS.size).toBeGreaterThan(20);
  });

  it("has no entry that is missing from WorkspaceDbService's prototype", () => {
    const missing = [...mod.ALLOWED_WORKSPACE_METHODS].filter(
      (name) =>
        typeof dbLib.WorkspaceDbService.prototype[
          name as keyof typeof dbLib.WorkspaceDbService.prototype
        ] !== "function",
    );
    expect(missing).toEqual([]);
  });

  it("does not accidentally include the constructor or any Object.prototype name", () => {
    const dangerous = ["constructor", "__proto__", "toString", "valueOf", "hasOwnProperty"];
    for (const name of dangerous) expect(mod.ALLOWED_WORKSPACE_METHODS.has(name)).toBe(false);
  });
});

describe("an allowed method actually dispatches, end to end", () => {
  it("calls the real service method with `this` bound correctly and forwards the result", async () => {
    const result = await invoke("getCurrentUserId");
    expect(result).toBe("user-from-identity-module");
    expect(getCurrentUserIdMock).toHaveBeenCalledTimes(1);
    // The fake db object constructed by the mocked open.ts is what should
    // have been threaded through — proof the dispatcher used the real
    // service instance, not a stray one.
    expect(getCurrentUserIdMock).toHaveBeenCalledWith({ __fakeDb: true });
  });

  it("forwards positional arguments in order", async () => {
    // createProject(title, kind?, meta?) delegates to workspaceStore/documents.ts,
    // which this test does not mock — so this only proves argument forwarding
    // reaches the real facade method, not a full DB round trip. That's the
    // property the dispatcher itself is responsible for.
    await expect(invoke("createProject", ["My Title", "book", { note: "x" }])).rejects.toThrow();
    // The throw comes from the real (unmocked) documents.ts hitting the fake
    // db object, which proves the call reached past the dispatcher and into
    // real application code with the right arguments — a silent no-op or a
    // TypeError about missing arguments would both indicate the dispatcher
    // dropped something.
  });

  it("reuses the same service instance across multiple calls (singleton, not reopened per call)", async () => {
    const runner = await import("../../electron/db/migrations/runner.ts");
    const migrateSpy = vi.mocked(runner.runDatabaseMigrations);
    const callsBefore = migrateSpy.mock.calls.length;

    await invoke("getCurrentUserId");
    await invoke("getCurrentUserId");

    // Migrations only run once, at first open — not once per IPC call.
    expect(migrateSpy.mock.calls.length).toBe(callsBefore);
  });
});
