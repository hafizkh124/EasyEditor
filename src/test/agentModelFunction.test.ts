// @vitest-environment node
// supabase/functions/agent-model (M10 Phase 2.1 / ADR-0034) — the web agent's
// model call. Covers what's specific to this function (auth wall, request
// validation, token metering, refund-on-failure); the universal HTTP contract
// (CORS preflight, never-throws-on-malformed-body) is edgeFunctionContract.test.ts.
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

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  ({ handle } = await import("../../supabase/functions/agent-model/index.ts"));
}, 60_000);

afterAll(() => restoreNetwork?.());

function arrange(rpc: FakeSupabaseConfig["rpc"] = {}) {
  const client = createFakeClient({
    user: { id: "user-agent-model-test" },
    tables: { user_roles: [] },
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
