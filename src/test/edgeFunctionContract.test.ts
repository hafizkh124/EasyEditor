// @vitest-environment node
// The HTTP contract every Supabase Edge Function must honour.
//
// Until the handlers were exported, nothing here was testable: all 29 functions
// wrapped their whole body in an anonymous `serve(async (req) => …)`, so the
// only check that ever ran against them was scripts/smoke-edge-functions.mjs —
// which proves a function is deployed and boots, and deliberately asserts
// nothing about behaviour. The failure modes below (a browser blocked by a
// missing CORS header, a thrown exception surfacing as an opaque 500) are
// exactly what that gap allowed to ship.
//
// This file asserts only what is genuinely universal. Per-function behaviour —
// which payloads are valid, which routes need a JWT — belongs in that
// function's own test; see verifyReceiptHandler.test.ts for the pattern.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync } from "node:fs";
// Imported for its side effect too: installing `globalThis.Deno` before any
// function module is imported, since `Deno.serve(handle)` runs at import time.
import { blockNetwork } from "./helpers/denoShim";

const FUNCTIONS = readdirSync("supabase/functions", { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "_shared")
  .map((e) => e.name)
  .sort();

/**
 * Functions that legitimately do not answer CORS preflight.
 *
 * An explicit list, not a skip: if one of these ever gains a browser caller it
 * must gain CORS handling too, and removing it from here is the reminder.
 *   - mcp: the handler is built by @lovable.dev/mcp-js, which owns its own
 *     transport headers; we do not write the request logic.
 *   - process-email-queue: invoked by a schedule and by service-role callers,
 *     never from a page.
 */
const NO_CORS_PREFLIGHT = new Set(["mcp", "process-email-queue"]);

type Handler = (req: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
const importErrors = new Map<string, string>();

// Importing dozens of edge functions means transforming dozens of dependency
// trees, which comfortably exceeds Vitest's 10s default hook timeout — hence
// the explicit budget and the parallel import.
let restoreNetwork: () => void;

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  await Promise.all(
    FUNCTIONS.map(async (name) => {
      try {
        const mod = await import(`../../supabase/functions/${name}/index.ts`);
        if (typeof mod.handle === "function") handlers.set(name, mod.handle as Handler);
        else importErrors.set(name, `module has no exported \`handle\` (got ${typeof mod.handle})`);
      } catch (e) {
        importErrors.set(name, e instanceof Error ? e.message : String(e));
      }
    }),
  );
}, 120_000);

afterAll(() => restoreNetwork?.());

describe("every edge function", () => {
  it("has at least one function to test", () => {
    expect(FUNCTIONS.length).toBeGreaterThanOrEqual(28);
  });

  it("imports cleanly and exports a callable `handle`", () => {
    // Reported as one assertion so a broken import lists every casualty at once
    // rather than failing once per function with the same root cause.
    expect(Object.fromEntries(importErrors)).toEqual({});
    // Sorted: the imports run in parallel, so insertion order is completion
    // order, not FUNCTIONS order.
    expect([...handlers.keys()].sort()).toEqual(FUNCTIONS);
  });
});

describe.each(FUNCTIONS)("%s", (name) => {
  const handlerFor = (): Handler => {
    const h = handlers.get(name);
    if (!h) throw new Error(`no handler: ${importErrors.get(name) ?? "not imported"}`);
    return h;
  };

  it("answers CORS preflight with an allow-origin header", async () => {
    if (NO_CORS_PREFLIGHT.has(name)) return;
    const res = await handlerFor()(new Request("https://fn.test/", { method: "OPTIONS" }));

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
    // Without this the browser rejects the preflight for any request carrying a
    // JWT, which is nearly all of them.
    expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase())
      .toContain("authorization");
  });

  it("returns a Response rather than throwing on a malformed body", async () => {
    // A thrown exception becomes an opaque platform 500 with no CORS headers,
    // so the browser reports a CORS error and the real cause is invisible.
    const res = await handlerFor()(
      new Request("https://fn.test/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ this is not json",
      }),
    );

    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(600);
  });

  it("returns a Response rather than throwing on an empty body", async () => {
    const res = await handlerFor()(new Request("https://fn.test/", { method: "POST" }));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
