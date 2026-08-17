/**
 * Stand-in for `virtual:pwa-register`, which only exists when vite-plugin-pwa
 * is in the pipeline. The test config aliases the virtual id here so
 * `src/pwa/registerSW.ts` can be imported under Vitest; individual tests still
 * `vi.mock` this path to capture the callbacks they need.
 */
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {};
}
