// Stand-in for `https://deno.land/std@0.168.0/http/server.ts`, which 15 of the
// edge functions import for `serve`. Vitest cannot fetch a remote module, and
// we would not want it to: the point of importing a function's `index.ts` in a
// test is to reach its exported `handle`, not to start a listener.
//
// Wired up by the `deno-specifiers` plugin in vitest.config.ts.

/** No-op stand-in for std's `serve`. Records the handler for assertions. */
export function serve(handler: (req: Request) => Response | Promise<Response>): void {
  lastServedHandler = handler;
}

export let lastServedHandler: ((req: Request) => Response | Promise<Response>) | null = null;
