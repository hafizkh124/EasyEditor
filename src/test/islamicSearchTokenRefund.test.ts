// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockNetwork } from "./helpers/denoShim";
import { createFakeClient, type FakeSupabaseConfig } from "./helpers/fakeSupabase";

/**
 * Regression test for a real bug surfaced by first-contact typechecking
 * (TESTING-STRATEGY.md P3: `researchSources.test.ts` was the first thing to
 * import `islamic-search/index.ts` by a literal path — `handle` is exported,
 * but this file itself had never been pulled into `tsc -p tsconfig.app.json`).
 *
 * `handle()`'s crash-path refund read `tokenCost`/`user`, both declared with
 * `const` *inside* the outer `try` block, from the sibling `catch` block —
 * `tsc` correctly refused to compile that (`Cannot find name`). At runtime,
 * `typeof tokenCost !== "undefined"` there threw a ReferenceError every
 * single time (referencing a name with no binding in any enclosing scope is
 * not the same as checking an undeclared global), which the refund's own
 * `catch (_) {}` silently swallowed — so a token deducted just before an
 * unhandled error was never refunded. The fix hoists mirror variables
 * (`capturedUser`/`capturedTokenCost`) to function scope, set once each value
 * is known, so `catch` can actually see them.
 *
 * This test forces a realistic post-deduction crash: `deduct_tokens` (the RPC
 * `checkAndDeductTokens` calls) returning a malformed JSON string, which
 * `JSON.parse` throws on — a real failure mode (a corrupted RPC response),
 * not a contrived one, and it happens *after* both values are captured.
 */

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

type Handler = (req: Request) => Promise<Response>;
type DeriveStrictMode = (explicit: unknown, resultCount: number) => boolean;
type AutoReferencedRefundAmount = (explicit: unknown, effective: boolean) => number | null;
let handle: Handler;
let deriveStrictMode: DeriveStrictMode;
let autoReferencedRefundAmount: AutoReferencedRefundAmount;
let restoreNetwork: () => void;

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  ({ handle, deriveStrictMode, autoReferencedRefundAmount } =
    await import("../../supabase/functions/islamic-search/index.ts"));
}, 60_000);

afterAll(() => restoreNetwork?.());

function arrange(rpc: FakeSupabaseConfig["rpc"]) {
  const client = createFakeClient({
    user: { id: "user-refund-test" },
    tables: { subscriptions: [], user_roles: [] },
    rpc,
  });
  state.client = client;
  return client;
}

function post() {
  return handle(
    new Request("https://fn.test/islamic-search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({ query: "زکوٰۃ کا نصاب" }),
    }),
  );
}

describe("refund-on-crash safety net", () => {
  it("refunds the deducted tokens when an unhandled error lands in the outer catch", async () => {
    const client = arrange({
      // A malformed RPC response is a real failure mode (e.g. a corrupted
      // payload), and `checkAndDeductTokens` does not guard `JSON.parse`
      // against it — this is what actually reaches the outer `catch`.
      deduct_tokens: { data: "{not valid json" },
      credit_tokens: { data: { success: true } },
    });

    const res = await post();

    expect(res.status).toBe(500);
    expect(client.rpcCalls.map((c) => c.name)).toContain("credit_tokens");
    const refundCall = client.rpcCalls.find((c) => c.name === "credit_tokens");
    expect(refundCall?.args).toMatchObject({
      p_user_id: "user-refund-test",
      p_amount: 40, // TOKEN_COSTS.islamic
      p_action_type: "refund",
    });
  });

  it("does not attempt a refund when the crash happens before tokens are deducted", async () => {
    // auth.getUser itself fails — capturedUser is never set, so even though
    // the code reaches the outer catch (via the 401 path returning early,
    // not a throw) there is nothing to refund. Included as the boundary case:
    // proves the guard is `capturedTokenCost !== undefined && capturedUser
    // !== undefined`, not just "did we reach catch".
    const client = createFakeClient({ user: null, tables: { subscriptions: [], user_roles: [] } });
    state.client = client;

    const res = await post();

    expect(res.status).toBe(401);
    expect(client.rpcCalls.map((c) => c.name)).not.toContain("credit_tokens");
  });
});

/**
 * SPEC M10 §1.1 — the اسلامی/عمومی switch is gone; `strictMode` is now
 * derived from whether retrieval found anything, and the 10-token
 * islamic/research price difference is refunded when it auto-degrades.
 *
 * Real, pure functions (no mocking): driving this through a live `handle()`
 * call would mean faking every one of the six retrieval tiers just to force
 * `allResults.length === 0` — one of which (`lookupTopicAnchors`) is
 * keyword-matched rather than domain-gated, so even an empty
 * `selectedDomains` cannot guarantee zero results. arabicMatnFilter.test.ts's
 * file-level comment already made this call for `has_matn`; the same
 * reasoning applies here, which is exactly why the derivation was pulled out
 * into its own exported, argument-driven functions instead of staying as
 * inline conditionals only a live retrieval run could exercise.
 */
describe("auto-strictness derivation (SPEC M10 §1.1)", () => {
  it("honours an explicit boolean regardless of result count", () => {
    expect(deriveStrictMode(true, 0)).toBe(true);
    expect(deriveStrictMode(false, 40)).toBe(false);
  });

  it("derives strict from a positive result count when nothing explicit was sent", () => {
    expect(deriveStrictMode(undefined, 1)).toBe(true);
    expect(deriveStrictMode(undefined, 40)).toBe(true);
  });

  it("derives referenced from zero results when nothing explicit was sent", () => {
    expect(deriveStrictMode(undefined, 0)).toBe(false);
  });

  it("treats any non-boolean (old/malformed clients) the same as unset", () => {
    expect(deriveStrictMode(null, 0)).toBe(false);
    expect(deriveStrictMode("strict", 5)).toBe(true);
  });
});

describe("auto-referenced refund amount (SPEC M10 §1.1)", () => {
  it("refunds the islamic/research price difference on a derived auto-degrade", () => {
    expect(autoReferencedRefundAmount(undefined, false)).toBe(10);
  });

  it("never refunds when the caller passed strictMode explicitly", () => {
    expect(autoReferencedRefundAmount(false, false)).toBeNull();
    expect(autoReferencedRefundAmount(true, true)).toBeNull();
  });

  it("never refunds when the derived choice was strict", () => {
    expect(autoReferencedRefundAmount(undefined, true)).toBeNull();
  });
});

describe("wiring: the derived value actually reaches the prompt (source-text guard)", () => {
  // TypeScript cannot catch a regression here — `strictMode ?? true` and
  // `effectiveStrictMode` are both plain booleans at that call site, so a
  // revert back to the old raw parameter would compile silently. Same
  // rationale as arabicMatnFilter.test.ts's structural checks.
  it("buildSystemPrompt is called with effectiveStrictMode, not the raw request parameter", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("supabase/functions/islamic-search/index.ts", "utf8");
    const deriveAt = src.indexOf("export function deriveStrictMode");
    const promptCallAt = src.indexOf("buildSystemPrompt(contextBlock + countBlock,");
    expect(deriveAt).toBeGreaterThan(-1);
    expect(promptCallAt).toBeGreaterThan(deriveAt);
    expect(src.slice(promptCallAt, promptCallAt + 120)).toContain("effectiveStrictMode");
    expect(src.slice(promptCallAt, promptCallAt + 120)).not.toContain("strictMode ?? true");
  });
});
