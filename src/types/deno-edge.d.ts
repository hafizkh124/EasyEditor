/**
 * Minimal ambient `Deno` declaration for edge-function modules that tests
 * import directly (e.g. `_shared/citationEngine.ts` → `_shared/embed.ts`).
 *
 * Those files run on Deno in production, but `tsconfig.app.json` only knows
 * about the browser app. Without this, importing one into a Vitest test makes
 * `npm run typecheck` fail on `Cannot find name 'Deno'` even though the code
 * is correct for where it actually runs. Only the surface the shared modules
 * use is declared — anything more would let real mistakes through.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
};
