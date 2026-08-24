// @vitest-environment node
// check-subscription-expiry — daily cron that drops lapsed paid subscriptions
// back to free. Two claims in its own docstring are worth holding it to:
// "Idempotent: re-running does nothing for users already on the free tier" and
// admin users "are exempt from auto-downgrade". Neither is provable against a
// fake that doesn't actually filter rows, which is why fakeSupabase.ts's
// `.lt()`/`.neq()` now apply for real (see that file's design-note #3) — with
// a no-op filter these tests would pass by construction regardless of whether
// the production query filters anything.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockNetwork } from "./helpers/denoShim";
import { createFakeClient, type FakeClient } from "./helpers/fakeSupabase";

const state = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
let restoreNetwork: () => void;

const NOW = "2026-08-24T12:00:00.000Z";

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  ({ handle } = await import("../../supabase/functions/check-subscription-expiry/index.ts"));
}, 60_000);

afterAll(() => {
  restoreNetwork?.();
  vi.useRealTimers();
});

function arrange(tables: Record<string, unknown[]>): FakeClient {
  const client = createFakeClient({ tables });
  state.client = client;
  return client;
}

const post = () => handle(new Request("https://fn.test/check-subscription-expiry", { method: "POST" }));

const lapsed = (over: Record<string, unknown> = {}) => ({
  user_id: "user-lapsed-1",
  tier: "pro",
  expires_at: "2020-01-01T00:00:00.000Z", // far in the past
  ...over,
});

const active = (over: Record<string, unknown> = {}) => ({
  user_id: "user-active-1",
  tier: "pro",
  expires_at: "2030-01-01T00:00:00.000Z", // far in the future
  ...over,
});

describe("who may trigger a check", () => {
  it("answers CORS preflight", async () => {
    const res = await handle(new Request("https://fn.test/", { method: "OPTIONS" }));
    expect(res.status).toBeLessThan(400);
  });

  it("allows the cron path with no Authorization header", async () => {
    arrange({ user_roles: [], subscriptions: [] });
    const res = await post();
    expect(res.status).toBe(200);
  });

  it("rejects a non-service-role bearer token", async () => {
    arrange({ user_roles: [], subscriptions: [] });
    const res = await handle(
      new Request("https://fn.test/", { method: "POST", headers: { Authorization: "Bearer anon-key" } }),
    );
    expect(res.status).toBe(403);
  });
});

describe("nothing to do", () => {
  it("returns success with zero counts and writes nothing", async () => {
    const client = arrange({ user_roles: [], subscriptions: [] });
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      expired_count: 0,
      downgraded: [],
    });
    expect(client.writes).toEqual([]);
  });
});

describe("which subscriptions actually get touched", () => {
  it("downgrades a subscription whose expires_at is in the past", async () => {
    const client = arrange({ user_roles: [], subscriptions: [lapsed()] });
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ expired_count: 1 });
    expect(client.writesTo("subscriptions")[0].filters).toContainEqual({
      column: "user_id",
      value: ["user-lapsed-1"],
    });
  });

  it("leaves a subscription whose expires_at is still in the future untouched", async () => {
    // Real property, not a fixture-construction accident: the query itself
    // filters on `.lt("expires_at", now)`.
    const client = arrange({ user_roles: [], subscriptions: [active()] });
    const res = await post();

    await expect(res.json()).resolves.toMatchObject({ expired_count: 0 });
    expect(client.writes).toEqual([]);
  });

  it("is idempotent: a lapsed subscription already on the free tier is left alone", async () => {
    // The function's own docstring promises this. `.neq("tier", "free")` is
    // what has to actually exclude the row for that promise to be true.
    const client = arrange({ user_roles: [], subscriptions: [lapsed({ tier: "free" })] });
    const res = await post();

    await expect(res.json()).resolves.toMatchObject({ expired_count: 0 });
    expect(client.writes).toEqual([]);
  });

  it("only downgrades the lapsed rows out of a mixed batch", async () => {
    const client = arrange({
      user_roles: [],
      subscriptions: [
        lapsed({ user_id: "a" }),
        active({ user_id: "b" }),
        lapsed({ user_id: "c", tier: "free" }), // already free — excluded too
      ],
    });
    const res = await post();

    await expect(res.json()).resolves.toMatchObject({ expired_count: 1 });
    expect(client.writesTo("subscriptions")[0].filters).toContainEqual({
      column: "user_id",
      value: ["a"],
    });
  });

  it("sets every FREE_LIMITS field to zero, not just tier", async () => {
    const client = arrange({ user_roles: [], subscriptions: [lapsed()] });
    await post();

    expect(client.writesTo("subscriptions")[0].payload).toEqual({
      tier: "free",
      transcription_limit: 0,
      tts_character_limit: 0,
      ocr_pages_limit: 0,
      research_queries_limit: 0,
      islamic_queries_limit: 0,
    });
  });
});

describe("admin exemption", () => {
  it("does not downgrade a lapsed admin's subscription", async () => {
    const client = arrange({
      user_roles: [{ user_id: "user-lapsed-1", role: "admin" }],
      subscriptions: [lapsed()],
    });
    const res = await post();

    await expect(res.json()).resolves.toMatchObject({ expired_count: 0, skipped_admins: 1 });
    expect(client.writes).toEqual([]);
  });

  it("does not exempt a non-admin role of the same shape", async () => {
    const client = arrange({
      user_roles: [{ user_id: "user-lapsed-1", role: "editor" }],
      subscriptions: [lapsed()],
    });
    await post();
    expect(client.writesTo("subscriptions")).toHaveLength(1);
  });

  it("downgrades non-admins while exempting admins in the same batch", async () => {
    const client = arrange({
      user_roles: [{ user_id: "admin-1", role: "admin" }],
      subscriptions: [lapsed({ user_id: "admin-1" }), lapsed({ user_id: "regular-1" })],
    });
    const res = await post();

    await expect(res.json()).resolves.toMatchObject({ expired_count: 1, skipped_admins: 1 });
    expect(client.writesTo("subscriptions")[0].filters).toContainEqual({
      column: "user_id",
      value: ["regular-1"],
    });
  });

  it("tolerates the admin-role lookup itself failing — proceeds without exemptions", async () => {
    const client = createFakeClient({
      tables: { subscriptions: [lapsed()] },
      selectErrors: { user_roles: { message: "roles table unavailable" } },
    });
    state.client = client;
    const res = await post();

    // Degrades safely toward downgrading, not toward silently exempting
    // everyone because the exemption check itself broke.
    await expect(res.json()).resolves.toMatchObject({ expired_count: 1 });
  });
});

describe("wallet, audit trail, and notifications", () => {
  it("zeros monthly balance and limit but does not touch topup_balance", async () => {
    const client = arrange({ user_roles: [], subscriptions: [lapsed()] });
    await post();

    const wallet = client.writesTo("token_wallets")[0];
    expect(wallet.payload).toMatchObject({ monthly_balance: 0, monthly_limit: 0 });
    expect(wallet.payload).not.toHaveProperty("topup_balance");
  });

  it("writes a zero-amount expiry transaction per downgraded user", async () => {
    const client = arrange({
      user_roles: [],
      subscriptions: [lapsed({ user_id: "a" }), lapsed({ user_id: "b" })],
    });
    await post();

    const tx = client.writesTo("token_transactions")[0];
    expect(tx.op).toBe("insert");
    expect(tx.payload).toEqual([
      expect.objectContaining({ user_id: "a", amount: 0, action_type: "expiry" }),
      expect.objectContaining({ user_id: "b", amount: 0, action_type: "expiry" }),
    ]);
  });

  it("notifies every downgraded user", async () => {
    const client = arrange({ user_roles: [], subscriptions: [lapsed()] });
    await post();

    const notif = client.writesTo("notifications")[0];
    expect(notif.payload).toEqual([
      expect.objectContaining({ user_id: "user-lapsed-1", title: "Subscription expired" }),
    ]);
  });

  it.each(["token_wallets", "token_transactions", "notifications"])(
    "still reports success when the %s write fails — it is a secondary step",
    async (table) => {
      const client = createFakeClient({
        tables: { user_roles: [], subscriptions: [lapsed()] },
        writeErrors: { [table]: { message: "insert failed" } },
      });
      state.client = client;
      const res = await post();

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ expired_count: 1 });
    },
  );
});

describe("primary failures", () => {
  it("returns 500 when the expired-subscriptions query itself fails", async () => {
    const client = createFakeClient({
      tables: { user_roles: [] },
      selectErrors: { subscriptions: { message: "connection reset" } },
    });
    state.client = client;
    const res = await post();

    expect(res.status).toBe(500);
    expect(client.writes).toEqual([]);
  });

  it("returns 500 when the downgrade update itself fails", async () => {
    const client = createFakeClient({
      tables: { user_roles: [], subscriptions: [lapsed()] },
      writeErrors: { subscriptions: { message: "constraint violation" } },
    });
    state.client = client;
    const res = await post();

    expect(res.status).toBe(500);
    // The failed write is still attempted and recorded — but nothing past it runs.
    expect(client.writesTo("token_wallets")).toEqual([]);
  });
});
