// Minimal `Deno` global so an edge function's index.ts can be imported under
// Vitest. Import this for side effect BEFORE dynamically importing any function
// module — `Deno.serve(handle)` runs at import time and would otherwise throw.
//
//     import "./helpers/denoShim";
//     const { handle } = await import("../../supabase/functions/web-search/index.ts");
//
// The env values are deliberately unusable: these tests exercise the HTTP layer
// (method routing, validation, auth rejection, CORS), which returns long before
// any network or database call. A test that gets far enough to need a real
// credential has strayed out of the HTTP layer and should mock that dependency
// explicitly instead.
const DEFAULT_ENV: Record<string, string> = {
  SUPABASE_URL: "https://test.supabase.invalid",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
};

/** Handlers passed to `Deno.serve`, in import order. */
export const servedHandlers: Array<(req: Request) => Response | Promise<Response>> = [];

const env = new Map(Object.entries(DEFAULT_ENV));

const shim = {
  serve(handler: (req: Request) => Response | Promise<Response>) {
    servedHandlers.push(handler);
    // Real Deno.serve returns a server with these; nothing under test uses them.
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} };
  },
  env: {
    get: (key: string) => env.get(key),
    set: (key: string, value: string) => void env.set(key, value),
    has: (key: string) => env.has(key),
    delete: (key: string) => void env.delete(key),
    toObject: () => Object.fromEntries(env),
  },
};

const globalWithDeno = globalThis as typeof globalThis & { Deno?: typeof shim };
if (!globalWithDeno.Deno) globalWithDeno.Deno = shim;

/**
 * Replace `fetch` with an immediate rejection, and return a restore function.
 *
 * Two reasons this is not optional for the edge-function tests. Speed: several
 * handlers reach a Supabase call before returning, and letting that go to DNS
 * cost 14s per case waiting for `test.supabase.invalid` to fail to resolve.
 * Correctness: a machine or network with wildcard DNS *would* resolve it, so
 * "it fails to connect" is not a guarantee the environment provides — the test
 * has to provide it. A handler that gets this rejection is expected to return
 * an error Response, which is exactly the behaviour under test.
 */
export function blockNetwork(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    // Resolves with a 400 rather than rejecting. A rejection reads as a
    // *network* failure, which postgrest-js retries with backoff — that cost
    // 14s per case in check-subscription-expiry. A 4xx is a definitive answer,
    // so the client gives up immediately, and the handler still takes its error
    // path, which is what these tests are checking.
    const url = typeof input === "string" ? input : String(input);
    return Promise.resolve(
      new Response(JSON.stringify({ message: `network blocked in tests: ${url}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Override one variable for a test; returns a restore function. */
export function setDenoEnv(key: string, value: string | undefined): () => void {
  const had = env.has(key);
  const previous = env.get(key);
  if (value === undefined) env.delete(key);
  else env.set(key, value);
  return () => {
    if (had) env.set(key, previous!);
    else env.delete(key);
  };
}
