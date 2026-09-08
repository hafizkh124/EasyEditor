// @vitest-environment node
// supabase/functions/byok-keys (M10 Phase 2.5.2 / ADR-0036) — save/status/
// delete/test a user's own provider key. The universal HTTP contract (CORS,
// never-throws) is edgeFunctionContract.test.ts; this covers what's specific:
// the key never comes back in any response, encryption round-trips, and the
// auth/validation wall.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockNetwork, setDenoEnv } from "./helpers/denoShim";
import { createFakeClient, type FakeSupabaseConfig } from "./helpers/fakeSupabase";

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

type Handler = (req: Request) => Promise<Response>;
type DecryptFn = (encoded: string, secret: string) => Promise<string>;
let handle: Handler;
let decryptKey: DecryptFn;
let restoreNetwork: () => void;

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  ({ handle } = await import("../../supabase/functions/byok-keys/index.ts"));
  ({ decryptKey } = await import("../../supabase/functions/_shared/providerKeyCrypto.ts"));
}, 60_000);

afterAll(() => restoreNetwork?.());

function arrange(config: FakeSupabaseConfig = {}) {
  const client = createFakeClient({ user: { id: "user-byok-test" }, ...config });
  state.client = client;
  return client;
}

function post(body: unknown, opts: { auth?: string | null } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== null) headers.Authorization = opts.auth ?? "Bearer test-token";
  return handle(new Request("https://fn.test/byok-keys", { method: "POST", headers, body: JSON.stringify(body) }));
}

const SECRET = "test-provider-key-secret";

describe("byok-keys — auth wall", () => {
  it("401s with no Authorization header", async () => {
    arrange();
    const res = await post({ action: "status" }, { auth: null });
    expect(res.status).toBe(401);
  });

  it("401s when getUser resolves no user", async () => {
    arrange({ user: null });
    const res = await post({ action: "status" });
    expect(res.status).toBe(401);
  });
});

describe("byok-keys — validation", () => {
  it("400s on an invalid action", async () => {
    arrange();
    const res = await post({ action: "nonsense" });
    expect(res.status).toBe(400);
  });

  it("400s on save with no key", async () => {
    arrange();
    const res = await post({ action: "save", provider: "gemini" });
    expect(res.status).toBe(400);
  });

  it("400s on an unknown provider", async () => {
    arrange();
    const res = await post({ action: "save", provider: "chatgpt", key: "sk-something-long-enough" });
    expect(res.status).toBe(400);
  });
});

describe("byok-keys — save", () => {
  it("stores an encrypted key and returns only hasKey+lastFour, never the key", async () => {
    const restoreEnv = setDenoEnv("PROVIDER_KEY_SECRET", SECRET);
    const client = arrange();
    const res = await post({ action: "save", provider: "gemini", key: "AIzaSyTESTKEYaaaaaaaaaaaaaaaaaaaaaa" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hasKey: true, lastFour: "aaaa" });
    expect(JSON.stringify(body)).not.toContain("AIzaSy");

    const write = client.writesTo("user_provider_keys")[0];
    expect(write.op).toBe("upsert");
    const payload = write.payload as { encrypted_key: string; last_four: string; provider: string };
    expect(payload.provider).toBe("gemini");
    expect(payload.last_four).toBe("aaaa");
    expect(payload.encrypted_key).not.toContain("AIzaSy");

    // The encrypted column round-trips back to the exact plaintext.
    const decrypted = await decryptKey(payload.encrypted_key, SECRET);
    expect(decrypted).toBe("AIzaSyTESTKEYaaaaaaaaaaaaaaaaaaaaaa");
    restoreEnv();
  });

  it("500s with a clear message when PROVIDER_KEY_SECRET is not configured", async () => {
    arrange();
    const res = await post({ action: "save", provider: "gemini", key: "AIzaSyTESTKEYaaaaaaaaaaaaaaaaaaaaaa" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/PROVIDER_KEY_SECRET/);
  });

  it("encrypts the same key differently each time (a fresh random IV, not a fixed one)", async () => {
    const restoreEnv = setDenoEnv("PROVIDER_KEY_SECRET", SECRET);
    const client = arrange();
    await post({ action: "save", provider: "groq", key: "gsk_TESTKEYbbbbbbbbbbbbbbbbbbbbbbbb" });
    await post({ action: "save", provider: "groq", key: "gsk_TESTKEYbbbbbbbbbbbbbbbbbbbbbbbb" });
    const [w1, w2] = client.writesTo("user_provider_keys");
    const p1 = w1.payload as { encrypted_key: string };
    const p2 = w2.payload as { encrypted_key: string };
    expect(p1.encrypted_key).not.toBe(p2.encrypted_key);
    restoreEnv();
  });
});

describe("byok-keys — status", () => {
  it("reports hasKey:false for a provider with no row", async () => {
    arrange({ tables: { user_provider_keys: [] } });
    const res = await post({ action: "status", provider: "gemini" });
    const body = await res.json();
    expect(body).toEqual({ hasKey: false, lastFour: null });
  });

  it("reports hasKey:true + lastFour for a provider with a row, never the encrypted column", async () => {
    arrange({
      tables: {
        user_provider_keys: [
          { user_id: "user-byok-test", provider: "gemini", last_four: "wxyz", encrypted_key: "SHOULD-NEVER-LEAK" },
        ],
      },
    });
    const res = await post({ action: "status", provider: "gemini" });
    const body = await res.json();
    expect(body).toEqual({ hasKey: true, lastFour: "wxyz" });
    expect(JSON.stringify(body)).not.toContain("SHOULD-NEVER-LEAK");
  });

  it("returns a per-provider map when no provider is given", async () => {
    arrange({
      tables: {
        user_provider_keys: [
          { user_id: "user-byok-test", provider: "groq", last_four: "1234", encrypted_key: "x" },
        ],
      },
    });
    const res = await post({ action: "status" });
    const body = await res.json();
    expect(body.groq).toEqual({ hasKey: true, lastFour: "1234" });
    expect(body.gemini).toEqual({ hasKey: false, lastFour: null });
    expect(body.openrouter).toEqual({ hasKey: false, lastFour: null });
  });
});

describe("byok-keys — delete", () => {
  it("deletes the caller's own row, scoped by user_id and provider", async () => {
    const client = arrange();
    const res = await post({ action: "delete", provider: "openrouter" });
    expect(res.status).toBe(200);
    const write = client.writesTo("user_provider_keys")[0];
    expect(write.op).toBe("delete");
    expect(write.filters).toEqual(expect.arrayContaining([
      { column: "user_id", value: "user-byok-test" },
      { column: "provider", value: "openrouter" },
    ]));
  });
});

describe("byok-keys — test (pings the provider, saves nothing)", () => {
  it("400s without a key", async () => {
    arrange();
    const res = await post({ action: "test", provider: "gemini" });
    expect(res.status).toBe(400);
  });

  it("never writes to the database", async () => {
    const client = arrange();
    // network is blocked (blockNetwork), so the ping itself fails — that's
    // fine, this only asserts the action never touches storage either way.
    await post({ action: "test", provider: "gemini", key: "AIzaSyTESTKEYaaaaaaaaaaaaaaaaaaaaaa" });
    expect(client.writes).toHaveLength(0);
  });

  it("reports failure (not a throw) when the provider rejects the key", async () => {
    const res = await post({ action: "test", provider: "groq", key: "gsk_bad_but_long_enough_to_pass_validation" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
