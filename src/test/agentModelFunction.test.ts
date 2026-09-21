// @vitest-environment node
// supabase/functions/agent-model (M10 Phase 2.1 / ADR-0034) — the web agent's
// model call. Covers what's specific to this function (auth wall, request
// validation, token metering, refund-on-failure); the universal HTTP contract
// (CORS preflight, never-throws-on-malformed-body) is edgeFunctionContract.test.ts.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockNetwork, setDenoEnv } from "./helpers/denoShim";
import { createFakeClient, type FakeSupabaseConfig } from "./helpers/fakeSupabase";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
let restoreNetwork: () => void;

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  ({ handle } = await import("../../supabase/functions/agent-model/index.ts"));
}, 60_000);

afterAll(() => restoreNetwork?.());

function arrange(rpc: FakeSupabaseConfig["rpc"] = {}, tables: FakeSupabaseConfig["tables"] = {}) {
  const client = createFakeClient({
    user: { id: "user-agent-model-test" },
    tables: { user_roles: [], user_provider_keys: [], ...tables },
    rpc: {
      deduct_tokens: { data: { success: true, monthly_balance: 100, topup_balance: 0, total: 100 } },
      credit_tokens: { data: { success: true } },
      ...rpc,
    },
  });
  state.client = client;
  return client;
}

const VALID_BODY = {
  model: "google/gemini-2.5-flash",
  messages: [
    { role: "system", content: "SYS" },
    { role: "user", content: "hi" },
  ],
};

function post(body: unknown, opts: { auth?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== null) headers.Authorization = opts.auth ?? "Bearer test-token";
  return handle(new Request("https://fn.test/agent-model", { method: "POST", headers, body: JSON.stringify(body) }));
}

describe("agent-model", () => {
  it("401s with no Authorization header", async () => {
    arrange();
    const res = await post(VALID_BODY, { auth: null as unknown as string });
    expect(res.status).toBe(401);
  });

  it("401s when getUser resolves no user", async () => {
    const client = createFakeClient({ user: null, tables: { user_roles: [] } });
    state.client = client;
    const res = await post(VALID_BODY);
    expect(res.status).toBe(401);
  });

  it("400s on a body missing `model`", async () => {
    arrange();
    const res = await post({ messages: VALID_BODY.messages });
    expect(res.status).toBe(400);
  });

  it("400s on a body missing `messages`", async () => {
    arrange();
    const res = await post({ model: VALID_BODY.model });
    expect(res.status).toBe(400);
  });

  it("400s on an empty `messages` array", async () => {
    arrange();
    const res = await post({ ...VALID_BODY, messages: [] });
    expect(res.status).toBe(400);
  });

  it("deducts the agent_step cost before calling the model gateway", async () => {
    const client = arrange();
    await post(VALID_BODY);
    const call = client.rpcCalls.find((c) => c.name === "deduct_tokens");
    expect(call?.args).toMatchObject({ p_action_type: "agent_step" });
  });

  it("402s and deducts nothing further when the token balance is insufficient", async () => {
    arrange({ deduct_tokens: { data: { success: false, error: "Insufficient tokens", balance: 0, required: 15 } } });
    const res = await post(VALID_BODY);
    expect(res.status).toBe(402);
  });

  // The denoShim env has neither GEMINI_API_KEY nor LOVABLE_API_KEY set, so
  // callChatCompletions's own "no provider configured" 500 fires without ever
  // touching the network — a deterministic way to exercise the refund path.
  it("refunds the deducted tokens when the AI gateway has no provider configured", async () => {
    const client = arrange();
    const res = await post(VALID_BODY);
    expect(res.status).toBe(502);
    const refund = client.rpcCalls.find((c) => c.name === "credit_tokens");
    expect(refund).toBeTruthy();
  });

  it("passes tools/tool_choice through to the gateway body untouched", async () => {
    arrange();
    const body = {
      ...VALID_BODY,
      tools: [{ type: "function", function: { name: "search_corpus", description: "d", parameters: {} } }],
      tool_choice: "auto",
    };
    // No assertion on the outbound fetch (blocked) — this proves the request
    // is accepted (not a 400) with tools attached, i.e. the schema allows it.
    const res = await post(body);
    expect(res.status).not.toBe(400);
  });

  it("rejects a tool_choice / tools shape that fails the schema", async () => {
    arrange();
    const res = await post({ ...VALID_BODY, tool_choice: { nonsense: true } });
    expect(res.status).toBe(400);
  });
});

// M10 Phase 2.5.3 — BYOK routing. A stored user_provider_keys row must take
// over the model call entirely: no token deduction, body.model ignored in
// favor of the stored provider's own toolModel, and a provider-side failure
// surfaces as an error rather than silently falling back to the paid path
// (which would bill tokens the scholar did not expect).
describe("agent-model — BYOK routing", () => {
  it("skips checkAndDeductTokens entirely when a provider key is stored", async () => {
    const restoreEnv = setDenoEnv("PROVIDER_KEY_SECRET", "test-secret");
    const { encryptKey } = await import("../../supabase/functions/_shared/providerKeyCrypto.ts");
    const encrypted = await encryptKey("gsk_realkey0000000000000000000000000000", "test-secret");
    const client = arrange({}, { user_provider_keys: [
      { user_id: "user-agent-model-test", provider: "groq", encrypted_key: encrypted, updated_at: "2026-01-01" },
    ] });
    const res = await post(VALID_BODY);
    // network is blocked, so the actual provider call fails — this only
    // asserts the paid metering path was never even entered.
    expect(res.status).not.toBe(200);
    expect(client.rpcCalls.find((c) => c.name === "deduct_tokens")).toBeUndefined();
    restoreEnv();
  });

  it("surfaces a clear error (not a silent fallback to the paid path) when the provider rejects the BYOK key", async () => {
    const restoreEnv = setDenoEnv("PROVIDER_KEY_SECRET", "test-secret");
    const { encryptKey } = await import("../../supabase/functions/_shared/providerKeyCrypto.ts");
    const encrypted = await encryptKey("gsk_realkey0000000000000000000000000000", "test-secret");
    arrange({}, { user_provider_keys: [
      { user_id: "user-agent-model-test", provider: "groq", encrypted_key: encrypted, updated_at: "2026-01-01" },
    ] });
    const res = await post(VALID_BODY);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(body.error).toMatch(/Groq/);
    restoreEnv();
  });

  it("falls through to the normal paid path when PROVIDER_KEY_SECRET is not configured, even with a stored row", async () => {
    const client = arrange({}, { user_provider_keys: [
      { user_id: "user-agent-model-test", provider: "groq", encrypted_key: "whatever", updated_at: "2026-01-01" },
    ] });
    await post(VALID_BODY);
    expect(client.rpcCalls.find((c) => c.name === "deduct_tokens")).toBeTruthy();
  });

  it("uses the normal paid path when no key is stored at all", async () => {
    const client = arrange({}, { user_provider_keys: [] });
    await post(VALID_BODY);
    expect(client.rpcCalls.find((c) => c.name === "deduct_tokens")).toBeTruthy();
  });
});

// A Cohere (rerank) key lives in the SAME table as chat keys, and this function
// takes "the most recently updated row" as the active chat provider. Cohere is
// not a chat provider (no PROVIDERS entry), so a saved Cohere key used to make
// `PROVIDERS["cohere"]` undefined and the handler threw on `spec.baseUrl` —
// and again on `spec.label` in its own catch — breaking chat for that user
// the moment they saved a rerank key, until they deleted it.
describe("agent-model — a Cohere rerank key must never break chat", () => {
  const cohereRow = (updated_at: string) => ({
    user_id: "user-agent-model-test",
    provider: "cohere",
    encrypted_key: "irrelevant-not-a-chat-key",
    updated_at,
  });

  it("REGRESSION: a stored cohere key falls through to the normal paid path instead of crashing", async () => {
    const restoreEnv = setDenoEnv("PROVIDER_KEY_SECRET", "test-secret");
    const client = arrange({}, { user_provider_keys: [cohereRow("2026-09-20")] });

    const res = await post(VALID_BODY);

    // Chat proceeded on the metered path: tokens were deducted, and the failure
    // (blocked network / no gateway key) is the gateway's 502 — not an unhandled throw.
    expect(client.rpcCalls.find((c) => c.name === "deduct_tokens")).toBeTruthy();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/Cannot read|undefined|baseUrl|label/i);
    restoreEnv();
  });

  it("does not treat a cohere key as an active BYOK chat provider (no BYOK error message)", async () => {
    const restoreEnv = setDenoEnv("PROVIDER_KEY_SECRET", "test-secret");
    arrange({}, { user_provider_keys: [cohereRow("2026-09-20")] });
    const res = await post(VALID_BODY);
    const body = await res.json();
    expect(body.error ?? "").not.toMatch(/key ڈکرپٹ|آپ کی اپنی key/);
    restoreEnv();
  });
});
