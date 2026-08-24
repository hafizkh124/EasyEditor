// @vitest-environment node
// electron/ipc/registry.ts — "Never accept arbitrary channel names from
// renderer." isAllowedIpcChannel is the enforcement of that principle: every
// IPC surface in the app (main.ts's ipcMain wiring, preload.ts's bridge)
// exists to be reached through a channel name, so a gap here is a gap in
// every one of them at once. No electron mock needed — this module has no
// electron import at all, just a Set membership check.
import { describe, it, expect } from "vitest";
import {
  ALLOWED_IPC_CHANNELS,
  isAllowedIpcChannel,
} from "../../electron/ipc/registry.ts";

const REAL_CHANNELS = Object.values(ALLOWED_IPC_CHANNELS);

describe("isAllowedIpcChannel — every declared channel is allowed", () => {
  it.each(REAL_CHANNELS)("allows %s", (channel) => {
    expect(isAllowedIpcChannel(channel)).toBe(true);
  });

  it("the registry is non-empty", () => {
    // A guard against an accidental empty export making every test above
    // vacuously true.
    expect(REAL_CHANNELS.length).toBeGreaterThan(10);
  });
});

describe("isAllowedIpcChannel — rejects everything else", () => {
  it.each([
    "system:get-version ",
    " system:get-version",
    "System:Get-Version",
    "system:get-versionX",
    "xsystem:get-version",
    "workspace:invoke;drop",
  ])("rejects a near-miss of a real channel: %o", (channel) => {
    expect(isAllowedIpcChannel(channel)).toBe(false);
  });

  it.each([
    "__proto__",
    "constructor",
    "toString",
    "hasOwnProperty",
    "valueOf",
    "",
    "*",
  ])("rejects a prototype-pollution or wildcard attempt: %o", (channel) => {
    expect(isAllowedIpcChannel(channel)).toBe(false);
  });

  it("rejects an unrelated but plausible-sounding channel name", () => {
    expect(isAllowedIpcChannel("fs:read-file")).toBe(false);
    expect(isAllowedIpcChannel("shell:exec")).toBe(false);
  });

  it("does not throw on non-string input reaching the type guard", () => {
    for (const bad of [null, undefined, 42, {}, []] as unknown[]) {
      expect(() => isAllowedIpcChannel(bad as string)).not.toThrow();
      expect(isAllowedIpcChannel(bad as string)).toBe(false);
    }
  });
});

describe("ALLOWED_IPC_CHANNELS — internal consistency", () => {
  it("has no duplicate channel string across different keys", () => {
    // Two constants resolving to the same wire string would make one of them
    // silently unreachable, or worse, let one feature's handler answer for
    // another's channel name.
    const values = Object.values(ALLOWED_IPC_CHANNELS);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every value follows the domain:action naming convention", () => {
    for (const channel of REAL_CHANNELS) {
      expect(channel).toMatch(/^[a-z]+:[a-z-]+$/);
    }
  });
});
