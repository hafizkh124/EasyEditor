/**
 * Minimal ambient declarations for edge-function modules that tests import
 * directly (e.g. `_shared/citationEngine.ts` → `_shared/embed.ts`, and now
 * whole functions such as `verify-receipt/index.ts`).
 *
 * Those files run on Deno in production, but `tsconfig.app.json` only knows
 * about the browser app. Without this, importing one into a Vitest test makes
 * `npm run typecheck` fail on `Cannot find name 'Deno'` even though the code
 * is correct for where it actually runs. Only the surface the edge functions
 * actually use is declared — anything more would let real mistakes through.
 */
declare const Deno: {
  env: { get(key: string): string | undefined };
  /**
   * Used by 14 functions to bind their exported `handle`. The return value is
   * a server handle nothing in this repo inspects, so it stays `unknown`
   * rather than being modelled.
   */
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};

/**
 * Deno import specifiers, mapped to the packages already installed for the app.
 *
 * These are wildcards on the version segment on purpose: the functions pin nine
 * different version strings across `npm:` and `esm.sh`, and pinning them here
 * too would mean editing this file every time one is bumped. Vitest resolves
 * the same specifiers at runtime via the `deno-specifiers` plugin in
 * vitest.config.ts; this is the compile-time half of the same mapping.
 */
declare module "npm:@supabase/supabase-js@*" {
  export * from "@supabase/supabase-js";
}
declare module "https://esm.sh/@supabase/supabase-js@*" {
  export * from "@supabase/supabase-js";
}
declare module "npm:zod@*" {
  export * from "zod";
}

/** std's `serve`, imported by the 15 functions that predate `Deno.serve`. */
declare module "https://deno.land/std@*/http/server.ts" {
  export function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

/**
 * Platform-resolved packages with no npm counterpart installed here, so there
 * is nothing to borrow types from. Deliberately loose — `any` is honest about
 * the fact that we have no type information for them, and narrowing it would be
 * inventing a contract we have not verified.
 */
declare module "npm:@lovable.dev/*" {
  const value: any;
  export = value;
}
declare module "npm:@modelcontextprotocol/*" {
  const value: any;
  export = value;
}
