/**
 * getBackend() — the one place that decides which store the app talks to.
 *
 * This is ONE of only three files permitted to branch on the runtime target;
 * the other two are the nav list (SPEC-M5 FR-2.5) and the mode badge (FR-2.4).
 * A runtime check anywhere else is a bug: the whole point of the adapter is
 * that the ~40 UI files above it cannot tell which backend is underneath.
 *
 * M5.0 ships only `cloudBackend`, so behaviour is identical to M4.
 * `localBackend` (SQLite over IPC) arrives in M5.3.
 */
import type { WorkspaceBackend } from "./types";
import { cloudBackend } from "./cloudBackend";
import { localBackend } from "./localBackend";

export type * from "./types";
export { cloudBackend, localBackend };

/**
 * True when running inside the Electron shell rather than a browser tab.
 *
 * Reads the build-time flag that `vite.config.ts` injects for `--mode desktop`.
 * It deliberately does NOT sniff `window.electronAPI`: that would make the
 * answer depend on whether preload happened to have run yet, and `getBackend()`
 * can be called during module init, before it has.
 */
export function isDesktop(): boolean {
  return import.meta.env.VITE_DESKTOP === "true" || (typeof window !== "undefined" && Boolean((window as any).electronAPI?.isDesktop));
}

export function getBackend(): WorkspaceBackend {
  if (isDesktop()) {
    return localBackend;
  }
  return cloudBackend;
}

/**
 * Build a stable object that forwards every property access to the current
 * backend slice, resolved at CALL time rather than at import time.
 *
 * Why a proxy instead of `export const documentService = getBackend().documents`:
 * the latter captures whichever backend existed when the module was first
 * imported. Tests that swap the backend, and the desktop app's decision to
 * open a local database only after the user picks a data directory, both need
 * the lookup to happen per call.
 */
/** The object-valued slices — i.e. everything except the `kind` discriminant. */
type BackendSlice = Exclude<keyof WorkspaceBackend, "kind">;

type AnyRecord = Record<string | symbol, unknown>;

export function backendFacade<K extends BackendSlice>(slice: K): WorkspaceBackend[K] {
  const impl = () => getBackend()[slice] as unknown as AnyRecord;

  // `overrides` holds anything assigned directly onto the facade. This is what
  // makes `vi.spyOn(taskRunService, "listTaskRuns")` work: spyOn reads a
  // property descriptor, writes a replacement, and later restores it. A proxy
  // with only a `get` trap reports no own properties, and spyOn rejects it
  // with "listTaskRuns does not exist" — which is exactly how the M4 Trust-tab
  // tests caught this.
  const overrides: AnyRecord = {};

  return new Proxy(overrides as unknown as WorkspaceBackend[K], {
    get(_target, prop) {
      if (prop in overrides) return overrides[prop];
      const target = impl();
      const value = target[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },

    set(_target, prop, value) {
      overrides[prop] = value;
      return true;
    },

    deleteProperty(_target, prop) {
      delete overrides[prop];
      return true;
    },

    has(_target, prop) {
      return prop in overrides || prop in impl();
    },

    ownKeys() {
      return Reflect.ownKeys(impl());
    },

    getOwnPropertyDescriptor(_target, prop) {
      if (prop in overrides) {
        return { value: overrides[prop], writable: true, enumerable: true, configurable: true };
      }
      const target = impl();
      if (!(prop in target)) return undefined;
      const value = target[prop];
      return {
        value: typeof value === "function" ? value.bind(target) : value,
        writable: true,
        enumerable: true,
        // Must stay configurable: the target object is extensible and holds no
        // matching own property, so a non-configurable report would violate the
        // proxy invariants and throw.
        configurable: true,
      };
    },
  });
}
