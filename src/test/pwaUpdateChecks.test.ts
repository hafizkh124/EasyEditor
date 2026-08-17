/**
 * jsdom defaults to localhost, which `setupPWAUpdates` treats as a Lovable
 * preview host and bails out of entirely — so without a realistic URL every
 * assertion here would pass or fail for the wrong reason.
 *
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://editor.alulama.org/" }
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Update *detection* for the service worker.
 *
 * Activation stays manual on purpose (`registerType: "prompt"` in
 * vite.config.ts) — autoUpdate force-reloads every open tab and used to wipe
 * in-progress research answers. But detection used to run only on page load and
 * then hourly, so a tab that was already open when a deploy landed kept serving
 * the precached old bundle with no prompt, while `/app-version.json` reported
 * the new build. These pin the triggers that close that window.
 */

type RegisteredCb = (swUrl: string, reg: FakeRegistration | undefined) => void;
interface FakeRegistration {
  update: ReturnType<typeof vi.fn>;
}

let onRegisteredSW: RegisteredCb | undefined;

vi.mock("virtual:pwa-register", () => ({
  registerSW: (opts: { onRegisteredSW?: RegisteredCb }) => {
    onRegisteredSW = opts.onRegisteredSW;
    return vi.fn();
  },
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/i18n", () => ({
  getStoredLanguage: () => "en",
  translate: (_l: string, k: string) => k,
}));

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

async function boot(): Promise<FakeRegistration> {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  // A service worker must appear present or setup bails out early.
  if (!("serviceWorker" in navigator)) {
    Object.defineProperty(navigator, "serviceWorker", {
      value: { getRegistrations: () => Promise.resolve([]) },
      configurable: true,
    });
  }
  const { setupPWAUpdates } = await import("@/pwa/registerSW");
  setupPWAUpdates();
  const reg: FakeRegistration = { update: vi.fn().mockResolvedValue(undefined) };
  onRegisteredSW?.("/sw.js", reg);
  return reg;
}

describe("PWA update detection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    onRegisteredSW = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls for a new version far more often than the old hourly check", async () => {
    const reg = await boot();
    expect(reg.update).not.toHaveBeenCalled();

    // A minute of an open, visible tab used to produce nothing at all.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("checks immediately when the tab is brought back to the foreground", async () => {
    const reg = await boot();
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(31_000);
    reg.update.mockClear();

    setVisibility("visible");
    // Returning to the tab is the moment the user is most likely to be looking
    // at a freshly deployed app, so it must not wait for the next poll.
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("throttles bursts of focus events into a single request", async () => {
    const reg = await boot();
    // Let the poll fire, then wait out the throttle window so the first focus
    // event is genuinely eligible — otherwise this would assert nothing more
    // than "the poll just ran".
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.advanceTimersByTimeAsync(31_000);
    reg.update.mockClear();

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    expect(reg.update).toHaveBeenCalledTimes(1);
  });

  it("stops polling while the tab is hidden", async () => {
    const reg = await boot();
    setVisibility("hidden");
    reg.update.mockClear();

    // A background tab polling forever is waste; it re-checks on return.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(reg.update).not.toHaveBeenCalled();
  });

  it("survives an update() rejection so later checks still run", async () => {
    const reg = await boot();
    reg.update.mockRejectedValueOnce(new Error("offline"));

    await vi.advanceTimersByTimeAsync(61_000);
    expect(reg.update).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(61_000);
    expect(reg.update).toHaveBeenCalledTimes(2);
  });
});
