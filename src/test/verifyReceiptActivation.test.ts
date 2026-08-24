// @vitest-environment node
// verify-receipt, past the auth wall.
//
// This is the code that grants a paid tier with no human in the loop: the
// replay check on `payment_reference`, the `storagePath` ownership rule, and
// `autoApprove`'s writes to tier, expiry, token wallet and the payment log.
// Until `createClient` could be faked, none of it was reachable from a test —
// `verifyReceiptHandler.test.ts` documents exactly this as its known gap.
//
// The assertions are about the *writes issued*, not about a simulated database
// (see src/test/helpers/fakeSupabase.ts for why). What matters here is that a
// user who paid gets what they paid for, exactly once, and that a user who did
// not gets nothing.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { blockNetwork, setDenoEnv } from "./helpers/denoShim";
import { createFakeClient, type FakeClient } from "./helpers/fakeSupabase";

// Hoisted so the `vi.mock` factories below — which run before any import — can
// reach the per-test client and AI response.
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

const USER_ID = "user-abc-123";

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  // Without a key the handler short-circuits with 500 "AI gateway not
  // configured" before it reaches anything interesting.
  restoreKey = setDenoEnv("GEMINI_API_KEY", "test-gemini-key");
  ({ handle } = await import("../../supabase/functions/verify-receipt/index.ts"));
}, 60_000);

afterAll(() => {
  restoreNetwork?.();
  restoreKey?.();
});

/** A receipt image the storage download will hand back. */
const receiptBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

/** An AI verdict that passes every check for the pro tier. */
const cleanVerdict = (over: Record<string, unknown> = {}) => ({
  confidence: 97,
  amount: 5400,
  receiver: "Hafiz Khizar Hayat",
  txnId: "TXN-99887766",
  date: "2026-08-24",
  tampered: false,
  reasons: [],
  ...over,
});

function arrange(over: Parameters<typeof createFakeClient>[0] = {}): FakeClient {
  const client = createFakeClient({
    claims: { sub: USER_ID },
    storageDownload: { data: receiptBlob() },
    // No prior row with this reference → not a replay.
    tables: { subscriptions: [], admin_payments: [] },
    ...over,
  });
  state.client = client;
  return client;
}

const post = (body: unknown) =>
  handle(
    new Request("https://fn.test/verify-receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-jwt" },
      body: JSON.stringify(body),
    }),
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  planId: "pro",
  referenceNo: "TXN-99887766",
  storagePath: `${USER_ID}/receipt.jpg`,
  ...over,
});

beforeEach(() => {
  state.aiPayload = cleanVerdict();
  state.aiOk = true;
  state.aiThrows = false;
});

describe("request validation, now that claims resolve", () => {
  it.each([
    ["missing planId", { planId: undefined }, "Invalid planId"],
    ["unknown tier", { planId: "enterprise" }, "Invalid planId"],
    ["free tier is not purchasable", { planId: "free" }, "Invalid planId"],
    ["empty referenceNo", { referenceNo: "" }, "Invalid referenceNo"],
    ["referenceNo too short", { referenceNo: "ab" }, "Invalid referenceNo"],
    ["whitespace referenceNo", { referenceNo: "   " }, "Invalid referenceNo"],
  ])("rejects %s with 400", async (_label, over, message) => {
    arrange();
    const res = await post(validBody(over));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: message });
  });

  it("writes nothing when validation fails", async () => {
    const client = arrange();
    await post(validBody({ planId: "enterprise" }));
    expect(client.writes).toEqual([]);
  });
});

describe("storagePath ownership", () => {
  // The path is caller-supplied and is used to read from a shared bucket, so
  // this check is the only thing stopping one user naming another user's
  // receipt and having it verified as their own payment.
  it.each([
    ["another user's folder", "someone-else/receipt.jpg"],
    ["bucket root", "receipt.jpg"],
    ["traversal", "../other-user/receipt.jpg"],
    ["absolute-looking", "/receipt.jpg"],
    ["a prefix of the user id", `${USER_ID.slice(0, 4)}/receipt.jpg`],
    ["user id without the separator", `${USER_ID}receipt.jpg`],
  ])("rejects %s with 400 and downloads nothing", async (_label, storagePath) => {
    const client = arrange();
    const res = await post(validBody({ storagePath }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "Invalid storagePath" });
    expect(client.storageDownloads).toEqual([]);
    expect(client.writes).toEqual([]);
  });

  it("accepts a path inside the caller's own folder", async () => {
    const client = arrange();
    const res = await post(validBody({ storagePath: `${USER_ID}/nested/receipt.png` }));

    expect(res.status).toBe(200);
    expect(client.storageDownloads).toEqual([
      { bucket: "payment-receipts", path: `${USER_ID}/nested/receipt.png` },
    ]);
  });
});

describe("replay protection", () => {
  it("rejects a reference already on a subscription", async () => {
    // The fake now applies `.eq()` for real (see fakeSupabase.ts), so the row
    // must actually carry the reference being checked — an unfiltered fake
    // would have let a row with no payment_reference at all pass as a match.
    const client = arrange({
      tables: {
        subscriptions: [{ user_id: "someone", payment_reference: "TXN-99887766" }],
        admin_payments: [],
      },
    });
    const res = await post(validBody());

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: "duplicate_reference" });
    expect(client.writes).toEqual([]);
  });

  it("rejects a reference already in the payment log", async () => {
    const client = arrange({
      tables: { subscriptions: [], admin_payments: [{ id: 1, payment_reference: "TXN-99887766" }] },
    });
    const res = await post(validBody());

    expect(res.status).toBe(409);
    expect(client.writes).toEqual([]);
  });

  it("checks for a replay before spending anything on the receipt", async () => {
    // Downloading and running vision on a receipt we are going to reject anyway
    // costs money on every retry, so ordering here is a real property.
    const client = arrange({
      tables: {
        subscriptions: [{ user_id: "someone", payment_reference: "TXN-99887766" }],
        admin_payments: [],
      },
    });
    await post(validBody());
    expect(client.storageDownloads).toEqual([]);
  });

  it("trims the reference before checking, so padding cannot bypass it", async () => {
    const client = arrange({ tables: { subscriptions: [{ user_id: "someone" }], admin_payments: [] } });
    await post(validBody({ referenceNo: "  TXN-99887766  " }));

    const checked = client.reads.filter((r) => r.table === "subscriptions");
    expect(checked[0].filters).toContainEqual({
      column: "payment_reference",
      value: "TXN-99887766",
    });
  });
});

describe("auto-approval writes", () => {
  it("grants exactly the tier that was paid for", async () => {
    const client = arrange();
    const res = await post(validBody());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true, autoApproved: true });

    const [sub] = client.writesTo("subscriptions");
    expect(sub.op).toBe("update");
    expect(sub.payload).toMatchObject({
      tier: "pro",
      is_approved: true,
      upgrade_requested: false,
      pending_tier: null,
      ai_verification_status: "auto_approved",
      billing_cycle_days: 30,
    });
    expect(sub.filters).toContainEqual({ column: "user_id", value: USER_ID });
  });

  it("applies the pro tier's limits, not another tier's", async () => {
    const client = arrange();
    await post(validBody());

    expect(client.writesTo("subscriptions")[0].payload).toMatchObject({
      transcription_limit: 18_000,
      ocr_pages_limit: 300,
      research_queries_limit: 200,
      islamic_queries_limit: 100,
      tts_character_limit: 0,
    });
  });

  it("resets usage counters so the new period starts clean", async () => {
    // Without this an upgrading user inherits the usage that hit their old cap
    // and is immediately limited again on the plan they just paid for.
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

  it("sets an expiry 30 days out", async () => {
    const client = arrange();
    const before = Date.now();
    await post(validBody());

    const payload = client.writesTo("subscriptions")[0].payload as Record<string, string>;
    const activated = Date.parse(payload.activated_at);
    const expires = Date.parse(payload.expires_at);

    expect(activated).toBeGreaterThanOrEqual(before);
    expect(expires - activated).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("credits the wallet with the tier's token allocation, once", async () => {
    const client = arrange();
    await post(validBody());

    const wallet = client.writesTo("token_wallets");
    expect(wallet).toHaveLength(1);
    expect(wallet[0].op).toBe("upsert");
    expect(wallet[0].payload).toMatchObject({
      user_id: USER_ID,
      monthly_balance: 25_000,
      monthly_limit: 25_000,
    });
    // Upserting on user_id is what stops a second activation doubling the
    // balance instead of resetting it.
    expect(wallet[0].options).toMatchObject({ onConflict: "user_id" });
  });

  it("logs the payment exactly once, at the tier's real price", async () => {
    const client = arrange();
    await post(validBody());

    const payments = client.writesTo("admin_payments");
    expect(payments).toHaveLength(1);
    expect(payments[0].op).toBe("insert");
    expect(payments[0].payload).toMatchObject({
      user_id: USER_ID,
      amount_pkr: 5400,
      payment_reference: "TXN-99887766",
      tier_at_payment: "pro",
      payment_method: "manual_ai_verified",
    });
  });

  it("approves the profile and notifies the user", async () => {
    const client = arrange();
    await post(validBody());

    expect(client.writesTo("profiles")[0].payload).toMatchObject({ is_approved: true });
    expect(client.writesTo("notifications")).toHaveLength(1);
  });

  it.each([
    ["basic", 1_400, 5_000],
    ["pro", 5_400, 25_000],
    ["ultra", 8_400, 50_000],
  ])("prices and credits %s correctly", async (planId, amount, tokens) => {
    const client = arrange();
    state.aiPayload = cleanVerdict({ amount });
    await post(validBody({ planId, referenceNo: `TXN-${planId}` }));

    expect(client.writesTo("subscriptions")[0].payload).toMatchObject({ tier: planId });
    expect(client.writesTo("token_wallets")[0].payload).toMatchObject({ monthly_balance: tokens });
    expect(client.writesTo("admin_payments")[0].payload).toMatchObject({ amount_pkr: amount });
  });

  it("stops and reports when the subscription write fails", async () => {
    // The wallet must not be credited for an activation that did not happen.
    const client = arrange({ writeErrors: { subscriptions: { message: "constraint violation" } } });
    const res = await post(validBody());

    expect(res.status).toBe(500);
    expect(client.writesTo("token_wallets")).toEqual([]);
    expect(client.writesTo("admin_payments")).toEqual([]);
  });
});

describe("manual review does not activate anything", () => {
  it.each([
    ["low confidence", cleanVerdict({ confidence: 40 })],
    ["wrong amount", cleanVerdict({ amount: 100 })],
    ["unknown receiver", cleanVerdict({ receiver: "Someone Else" })],
    ["tampered", cleanVerdict({ tampered: true })],
    // The hole receiptDecision.ts closed, asserted end-to-end through the
    // handler this time rather than against the decision function alone.
    ["unreadable receiver", cleanVerdict({ receiver: "0" })],
    ["empty receiver", cleanVerdict({ receiver: "" })],
  ])("flags %s for review and grants no tier", async (_label, verdict) => {
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
    expect(sub.payload).not.toHaveProperty("tier");
    expect(client.writesTo("token_wallets")).toEqual([]);
    expect(client.writesTo("admin_payments")).toEqual([]);
  });

  it("records why it was flagged", async () => {
    const client = arrange();
    state.aiPayload = cleanVerdict({ confidence: 40, amount: 1 });
    await post(validBody());

    const details = (client.writesTo("subscriptions")[0].payload as Record<string, unknown>)
      .ai_verification_details as Record<string, unknown>;
    expect(details.failed_checks).toEqual(
      expect.arrayContaining(["low_confidence", "amount_mismatch"]),
    );
  });
});

describe("upstream failures never activate", () => {
  it("returns 400 when the receipt cannot be downloaded", async () => {
    const client = arrange({ storageDownload: { data: null, error: { message: "not found" } } });
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

  it("returns 503 when the AI call throws", async () => {
    const client = arrange();
    state.aiThrows = true;
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
