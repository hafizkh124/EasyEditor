// @vitest-environment node
// verify-renewal-receipt, past the auth wall.
//
// Mirrors verifyReceiptActivation.test.ts for the new-activation flow, but this
// file exists for the parts of renewal that are genuinely different: an
// existing tier is required, the expiry math extends from whichever is later
// (current expiry or now — so a lapsed renewal does not start counting from a
// date already in the past), and renewal_count increments. None of this was
// reachable before the createClient fake, same as the new-activation path.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { blockNetwork, setDenoEnv } from "./helpers/denoShim";
import { createFakeClient, type FakeClient } from "./helpers/fakeSupabase";

const state = vi.hoisted(() => ({
  client: null as unknown,
  aiPayload: null as unknown,
  aiOk: true,
  aiThrows: false,
}));

vi.mock("npm:@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

vi.mock("../../supabase/functions/_shared/aiGateway.ts", () => ({
  callChatCompletions: async () => {
    if (state.aiThrows) throw new Error("gateway exploded");
    if (!state.aiOk) return new Response("upstream error", { status: 502 });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(state.aiPayload) } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  },
}));

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
let restoreNetwork: () => void;
let restoreKey: () => void;

const USER_ID = "user-renew-456";

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  restoreKey = setDenoEnv("GEMINI_API_KEY", "test-gemini-key");
  ({ handle } = await import("../../supabase/functions/verify-renewal-receipt/index.ts"));
}, 60_000);

afterAll(() => {
  restoreNetwork?.();
  restoreKey?.();
});

const receiptBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

const cleanVerdict = (over: Record<string, unknown> = {}) => ({
  confidence: 96,
  amount: 5400,
  receiver: "Ulama Centre",
  txnId: "TXN-RENEW-001",
  date: "2026-08-24",
  tampered: false,
  reasons: [],
  ...over,
});

/**
 * An active pro-tier subscription row, as the "existing tier" lookup returns
 * it. `user_id` matters now that the fake applies `.eq()` for real (see
 * fakeSupabase.ts) — without it, the tier lookup's `.eq("user_id", userId)`
 * would filter this row out and every test would 400 on "no active plan".
 */
/** Always 7 days out from whenever the suite actually runs — a fixed
 * calendar date here goes stale and starts reading as "already lapsed"
 * once real time catches up to it. */
const FUTURE_EXPIRY = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const activeSub = (over: Record<string, unknown> = {}) => ({
  user_id: USER_ID,
  tier: "pro",
  expires_at: FUTURE_EXPIRY, // in the future relative to "now" below
  renewal_count: 2,
  ...over,
});

function arrange(over: Parameters<typeof createFakeClient>[0] = {}): FakeClient {
  const client = createFakeClient({
    claims: { sub: USER_ID },
    storageDownload: { data: receiptBlob() },
    tables: { subscriptions: [activeSub()], admin_payments: [] },
    ...over,
  });
  state.client = client;
  return client;
}

const post = (body: unknown) =>
  handle(
    new Request("https://fn.test/verify-renewal-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-jwt" },
      body: JSON.stringify(body),
    }),
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  referenceNo: "TXN-RENEW-001",
  storagePath: `${USER_ID}/renewal.jpg`,
  ...over,
});

beforeEach(() => {
  state.aiPayload = cleanVerdict();
  state.aiOk = true;
  state.aiThrows = false;
});

describe("an existing tier is required", () => {
  it("refuses to renew a user with no subscription row at all", async () => {
    const client = arrange({ tables: { subscriptions: [], admin_payments: [] } });
    const res = await post(validBody());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "No active plan to renew. Use a new subscription instead.",
    });
    expect(client.writes).toEqual([]);
  });

  it.each([
    ["null tier", null],
    ["free tier", "free"],
    ["empty string", ""],
    ["an unknown tier", "enterprise"],
  ])("refuses to renew when the stored tier is %s", async (_label, tier) => {
    const client = arrange({ tables: { subscriptions: [activeSub({ tier })], admin_payments: [] } });
    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(client.writes).toEqual([]);
  });

  it("checks for an existing tier before checking for a replay", async () => {
    // Ordering matters: no point running a replay check for a user who cannot
    // renew at all. A duplicate reference sitting in admin_payments must not
    // even be consulted once the tier lookup has already returned 400.
    const client = arrange({ tables: { subscriptions: [], admin_payments: [{ id: 1 }] } });
    const res = await post(validBody());

    expect(res.status).toBe(400);
    expect(client.reads.some((r) => r.table === "admin_payments")).toBe(false);
  });
});

describe("storagePath ownership and replay, same rules as new activation", () => {
  it("rejects a path outside the caller's own folder", async () => {
    const client = arrange();
    const res = await post(validBody({ storagePath: "someone-else/receipt.jpg" }));
    expect(res.status).toBe(400);
    expect(client.storageDownloads).toEqual([]);
  });

  it("rejects an already-used reference", async () => {
    const client = arrange({
      tables: {
        subscriptions: [activeSub(), { user_id: "someone", payment_reference: "TXN-RENEW-001" }],
        admin_payments: [],
      },
    });
    const res = await post(validBody());
    expect(res.status).toBe(409);
    expect(client.writes).toEqual([]);
  });
});

describe("expiry math — the part unique to renewal", () => {
  it("extends from the current expiry when the plan has not lapsed", async () => {
    const client = arrange({
      tables: {
        subscriptions: [activeSub({ expires_at: FUTURE_EXPIRY })],
        admin_payments: [],
      },
    });
    await post(validBody());

    const payload = client.writesTo("subscriptions")[0].payload as Record<string, string>;
    const newExpiry = Date.parse(payload.expires_at);
    const oldExpiry = Date.parse(FUTURE_EXPIRY);

    expect(newExpiry - oldExpiry).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("extends from now when the plan has already lapsed, not from the stale expiry", async () => {
    // A user renewing a month after lapsing must get a fresh 30 days from
    // today. Extending from the old, already-past expires_at would grant them a
    // subscription that is already partially or fully expired the moment it is
    // written.
    const client = arrange({
      tables: {
        subscriptions: [activeSub({ expires_at: "2020-01-01T00:00:00.000Z" })],
        admin_payments: [],
      },
    });
    const before = Date.now();
    await post(validBody());
    const after = Date.now();

    const payload = client.writesTo("subscriptions")[0].payload as Record<string, string>;
    const newExpiry = Date.parse(payload.expires_at);

    expect(newExpiry).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
    expect(newExpiry).toBeLessThanOrEqual(after + 30 * 24 * 60 * 60 * 1000);
  });

  it("treats a missing expires_at as lapsed (extends from now)", async () => {
    const client = arrange({
      tables: { subscriptions: [activeSub({ expires_at: null })], admin_payments: [] },
    });
    const before = Date.now();
    await post(validBody());

    const payload = client.writesTo("subscriptions")[0].payload as Record<string, string>;
    expect(Date.parse(payload.expires_at)).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000);
  });

  it("increments renewal_count from whatever it already was", async () => {
    const client = arrange({
      tables: { subscriptions: [activeSub({ renewal_count: 7 })], admin_payments: [] },
    });
    await post(validBody());
    expect(client.writesTo("subscriptions")[0].payload).toMatchObject({ renewal_count: 8 });
  });

  it("starts renewal_count at 1 when it was never set", async () => {
    const client = arrange({
      tables: { subscriptions: [activeSub({ renewal_count: null })], admin_payments: [] },
    });
    await post(validBody());
    expect(client.writesTo("subscriptions")[0].payload).toMatchObject({ renewal_count: 1 });
  });
});

describe("auto-approval writes", () => {
  it("resets usage counters for the new period", async () => {
    const client = arrange();
    await post(validBody());
    expect(client.writesTo("subscriptions")[0].payload).toMatchObject({
      transcription_seconds_used: 0,
      tts_characters_used: 0,
      ocr_pages_used: 0,
      research_queries_used: 0,
      islamic_queries_used: 0,
    });
  });

  it("does not touch `tier` — renewal keeps the existing plan, it does not grant one", async () => {
    const client = arrange();
    await post(validBody());
    expect(client.writesTo("subscriptions")[0].payload).not.toHaveProperty("tier");
  });

  it("resets the wallet to the stored tier's allocation, and issues no other write to it", async () => {
    // The dead credit_tokens RPC call this test also guards against: it used to
    // fire with a hard-coded p_amount of 1 immediately before this update, which
    // both wasted a round-trip and wrote a misleading token_transactions entry
    // (see the comment in the handler for the full story). Asserting exactly
    // one rpc call and exactly one wallet write catches either half of that
    // regressing independently.
    const client = arrange({ tables: { subscriptions: [activeSub({ tier: "ultra" })], admin_payments: [] } });
    state.aiPayload = cleanVerdict({ amount: 8400 });
    await post(validBody());

    expect(client.rpcCalls).toEqual([]);
    const wallet = client.writesTo("token_wallets");
    expect(wallet).toHaveLength(1);
    expect(wallet[0].op).toBe("update");
    expect(wallet[0].payload).toEqual({ monthly_balance: 50_000 });
    expect(wallet[0].filters).toContainEqual({ column: "user_id", value: USER_ID });
  });

  it.each([
    ["basic", 1_400, 5_000],
    ["pro", 5_400, 25_000],
    ["ultra", 8_400, 50_000],
  ])("prices and credits a %s renewal correctly", async (tier, amount, tokens) => {
    const client = arrange({ tables: { subscriptions: [activeSub({ tier })], admin_payments: [] } });
    state.aiPayload = cleanVerdict({ amount });
    await post(validBody());

    expect(client.writesTo("token_wallets")[0].payload).toEqual({ monthly_balance: tokens });
    expect(client.writesTo("admin_payments")[0].payload).toMatchObject({ amount_pkr: amount, tier_at_payment: tier });
  });

  it("logs the payment as a renewal, not a new subscription", async () => {
    const client = arrange();
    await post(validBody());

    const payments = client.writesTo("admin_payments");
    expect(payments).toHaveLength(1);
    expect(payments[0].payload).toMatchObject({
      payment_type: "renewal",
      user_id: USER_ID,
      payment_reference: "TXN-RENEW-001",
    });
  });

  it("notifies the user that the subscription was renewed", async () => {
    const client = arrange();
    await post(validBody());
    const notif = client.writesTo("notifications");
    expect(notif).toHaveLength(1);
    expect(notif[0].payload).toMatchObject({ title: "Subscription renewed" });
  });

  it("stops and reports when the subscription write fails, crediting nothing", async () => {
    const client = arrange({ writeErrors: { subscriptions: { message: "constraint violation" } } });
    const res = await post(validBody());

    expect(res.status).toBe(500);
    expect(client.writesTo("token_wallets")).toEqual([]);
    expect(client.writesTo("admin_payments")).toEqual([]);
  });
});

describe("manual review does not renew anything", () => {
  it.each([
    ["low confidence", cleanVerdict({ confidence: 30 })],
    ["wrong amount", cleanVerdict({ amount: 1 })],
    ["unknown receiver", cleanVerdict({ receiver: "Nobody" })],
    ["tampered", cleanVerdict({ tampered: true })],
  ])("flags %s for review and extends nothing", async (_label, verdict) => {
    const client = arrange();
    state.aiPayload = verdict;
    const res = await post(validBody());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ autoApproved: false });

    const [sub] = client.writesTo("subscriptions");
    expect(sub.payload).toMatchObject({
      upgrade_requested: true,
      pending_tier: "pro",
      ai_verification_status: "manual_review",
    });
    expect(sub.payload).not.toHaveProperty("expires_at");
    expect(sub.payload).not.toHaveProperty("renewal_count");
    expect(client.writesTo("token_wallets")).toEqual([]);
    expect(client.writesTo("admin_payments")).toEqual([]);
  });
});

describe("upstream failures never renew anything", () => {
  it("returns 400 when the receipt cannot be downloaded", async () => {
    const client = arrange({
      tables: { subscriptions: [activeSub()], admin_payments: [] },
      storageDownload: { data: null, error: { message: "not found" } },
    });
    const res = await post(validBody());
    expect(res.status).toBe(400);
    expect(client.writes).toEqual([]);
  });

  it("returns 503 when the AI gateway errors", async () => {
    const client = arrange();
    state.aiOk = false;
    const res = await post(validBody());
    expect(res.status).toBe(503);
    expect(client.writes).toEqual([]);
  });

  it("returns 500 when no AI key is configured", async () => {
    const client = arrange();
    const restore = setDenoEnv("GEMINI_API_KEY", undefined);
    try {
      const res = await post(validBody());
      expect(res.status).toBe(500);
      expect(client.writes).toEqual([]);
    } finally {
      restore();
    }
  });
});
