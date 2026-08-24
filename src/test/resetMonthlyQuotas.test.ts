// @vitest-environment node
// reset-monthly-quotas — a scheduled function with no user in the loop at all.
// It is deployed with no `verify_jwt` override in supabase/config.toml, is
// invoked by Supabase's own cron infra with no Authorization header, and is
// also invokable manually with the service-role key. Both paths matter: the
// cron path must not be accidentally locked out, and the manual path must
// reject anything that isn't the real service-role key.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockNetwork } from "./helpers/denoShim";
import { createFakeClient, type FakeSupabaseConfig } from "./helpers/fakeSupabase";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
let restoreNetwork: () => void;

const SERVICE_ROLE_KEY = "test-service-role-key"; // matches denoShim's default

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  ({ handle } = await import("../../supabase/functions/reset-monthly-quotas/index.ts"));
}, 60_000);

afterAll(() => restoreNetwork?.());

function arrange(rpc: FakeSupabaseConfig["rpc"] = {}) {
  const client = createFakeClient({ rpc });
  state.client = client;
  return client;
}

const post = (headers: Record<string, string> = {}) =>
  handle(new Request("https://fn.test/reset-monthly-quotas", { method: "POST", headers }));

describe("who may trigger a reset", () => {
  it("answers CORS preflight", async () => {
    const res = await handle(new Request("https://fn.test/", { method: "OPTIONS" }));
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("allows the cron path: no Authorization header at all", async () => {
    arrange();
    const res = await post();
    expect(res.status).toBe(200);
  });

  it("allows a manual call with the real service-role key", async () => {
    arrange();
    const res = await post({ Authorization: `Bearer ${SERVICE_ROLE_KEY}` });
    expect(res.status).toBe(200);
  });

  it("rejects a call with any other bearer token", async () => {
    arrange();
    const res = await post({ Authorization: "Bearer someone-elses-anon-key" });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Forbidden" });
  });

  it("rejects a Bearer header with no token, rather than treating it as absent", async () => {
    // Not the naive trace: the Fetch/Headers spec strips trailing HTTP
    // whitespace from header VALUES on the way in, so `Authorization: "Bearer "`
    // arrives at the handler as the literal string "Bearer" (no trailing
    // space). `.replace("Bearer ", "")` looks for that exact two-character
    // boundary and finds no match against "Bearer", so it returns the string
    // unchanged — providedKey ends up "Bearer", which is truthy and does not
    // equal the real service-role key, so this is a 403, not the 200 a
    // "trims to empty → falls through to the cron path" reading would predict.
    // Recorded because it is the one input where the naive trace and the
    // actual behaviour diverge, and the actual behaviour happens to be the
    // safe one: a malformed credential is rejected, not silently waved through.
    arrange();
    const res = await post({ Authorization: "Bearer " });
    expect(res.status).toBe(403);
  });
});

describe("a clean run", () => {
  it("reports the counts each RPC returned", async () => {
    const client = arrange({
      reset_monthly_tokens: { data: 42 },
      reset_monthly_quotas: { data: 7 },
      purge_expired_cache: { data: 130 },
    });
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      token_users_reset: 42,
      legacy_users_reset: 7,
      cache_purged: 130,
    });
    expect(client.rpcCalls.map((c) => c.name)).toEqual([
      "reset_monthly_tokens",
      "reset_monthly_quotas",
      "purge_expired_cache",
    ]);
  });

  it("passes the documented 15% bonus rate to reset_monthly_tokens", async () => {
    const client = arrange();
    await post();
    expect(client.rpcCalls[0]).toMatchObject({
      name: "reset_monthly_tokens",
      args: { p_bonus_rate: 0.15 },
    });
  });
});

describe("failure handling", () => {
  it("stops and reports 500 when the primary token reset fails", async () => {
    const client = arrange({ reset_monthly_tokens: { error: { message: "db exploded" } } });
    const res = await post();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "Failed to reset monthly tokens" });
    // Nothing downstream should run for a reset that already failed.
    expect(client.rpcCalls.map((c) => c.name)).toEqual(["reset_monthly_tokens"]);
  });

  it("tolerates the legacy reset failing — still 200, still reports what it can", async () => {
    const client = arrange({
      reset_monthly_tokens: { data: 5 },
      reset_monthly_quotas: { error: { message: "legacy table missing" } },
      purge_expired_cache: { data: 3 },
    });
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, token_users_reset: 5 });
    // The cache purge still ran even though the step before it failed.
    expect(client.rpcCalls.map((c) => c.name)).toContain("purge_expired_cache");
  });

  it("tolerates the cache purge failing — still 200", async () => {
    arrange({
      reset_monthly_tokens: { data: 5 },
      purge_expired_cache: { error: { message: "purge timed out" } },
    });
    const res = await post();
    expect(res.status).toBe(200);
  });

  it("returns 500 rather than propagating an unexpected throw", async () => {
    // rpc() is mocked to throw synchronously via a getter — simulates a client
    // construction failure or similar, not a well-formed {error} result.
    state.client = {
      rpc: () => {
        throw new Error("everything is on fire");
      },
    };
    const res = await post();
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ error: "everything is on fire" });
  });
});
