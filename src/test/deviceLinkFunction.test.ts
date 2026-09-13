// @vitest-environment node
// supabase/functions/device-link (2026-09-13) — the desktop Google
// sign-in workaround (device-authorization-grant style). Covers: create
// returns a fresh code, status reports pending/expired/claimed correctly,
// the confirmed→claimed hand-off mints exactly one token, confirm requires
// auth and only ever attaches the caller's own user_id, and the
// already-used/expired/not-found error paths.
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
  ({ handle } = await import("../../supabase/functions/device-link/index.ts"));
}, 60_000);

afterAll(() => restoreNetwork?.());

function arrange(config: FakeSupabaseConfig = {}) {
  const client = createFakeClient(config);
  state.client = client;
  return client;
}

function post(body: unknown, opts: { auth?: string | null } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth !== null) headers.Authorization = opts.auth ?? "Bearer test-token";
  return handle(new Request("https://fn.test/device-link", { method: "POST", headers, body: JSON.stringify(body) }));
}

const FUTURE = new Date(Date.now() + 5 * 60_000).toISOString();
const PAST = new Date(Date.now() - 5 * 60_000).toISOString();

describe("device-link — create", () => {
  it("returns a fresh 8-char code and inserts a pending row", async () => {
    const client = arrange();
    const res = await post({ action: "create" }, { auth: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(body.expiresAt).toBeTruthy();

    const write = client.writesTo("device_link_codes")[0];
    expect(write.op).toBe("insert");
    expect(write.payload).toMatchObject({ code: body.code, status: "pending" });
  });

  it("never requires auth", async () => {
    arrange();
    const res = await post({ action: "create" }, { auth: null });
    expect(res.status).toBe(200);
  });
});

describe("device-link — status", () => {
  it("404s on an unknown code", async () => {
    arrange({ tables: { device_link_codes: [] } });
    const res = await post({ action: "status", code: "ABCDEFGH" }, { auth: null });
    expect(res.status).toBe(404);
    expect((await res.json()).status).toBe("not_found");
  });

  it("reports pending for a live, unconfirmed code", async () => {
    arrange({
      tables: { device_link_codes: [{ id: "row-1", code: "ABCDEFGH", status: "pending", expires_at: FUTURE }] },
    });
    const res = await post({ action: "status", code: "ABCDEFGH" }, { auth: null });
    expect((await res.json()).status).toBe("pending");
  });

  it("expires a stale pending code instead of reporting it pending forever", async () => {
    const client = arrange({
      tables: { device_link_codes: [{ id: "row-1", code: "ABCDEFGH", status: "pending", expires_at: PAST }] },
    });
    const res = await post({ action: "status", code: "ABCDEFGH" }, { auth: null });
    expect((await res.json()).status).toBe("expired");
    const write = client.writesTo("device_link_codes")[0];
    expect(write.payload).toMatchObject({ status: "expired" });
  });

  it("reports claimed verbatim on a second poll — no second token", async () => {
    arrange({
      tables: { device_link_codes: [{ id: "row-1", code: "ABCDEFGH", status: "claimed", expires_at: FUTURE }] },
    });
    const res = await post({ action: "status", code: "ABCDEFGH" }, { auth: null });
    const body = await res.json();
    expect(body.status).toBe("claimed");
    expect(body.tokenHash).toBeUndefined();
  });

  it("on confirmed: mints exactly one magic-link token for the confirming user and marks the row claimed", async () => {
    const client = arrange({
      tables: {
        device_link_codes: [
          { id: "row-1", code: "ABCDEFGH", status: "confirmed", user_id: "user-1", expires_at: FUTURE },
        ],
      },
      adminUsers: { "user-1": { email: "scholar@example.com" } },
      adminGenerateLink: { data: { properties: { hashed_token: "test-hashed-token" } } },
    });
    const res = await post({ action: "status", code: "ABCDEFGH" }, { auth: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "confirmed", email: "scholar@example.com", tokenHash: "test-hashed-token" });

    expect(client.adminGenerateLinkCalls).toEqual([{ type: "magiclink", email: "scholar@example.com" }]);
    const claimWrite = client.writesTo("device_link_codes")[0];
    expect(claimWrite.payload).toMatchObject({ status: "claimed" });
  });

  it("500s with a clear error when the confirming user's email cannot be resolved", async () => {
    arrange({
      tables: {
        device_link_codes: [
          { id: "row-1", code: "ABCDEFGH", status: "confirmed", user_id: "ghost-user", expires_at: FUTURE },
        ],
      },
      adminUsers: {},
    });
    const res = await post({ action: "status", code: "ABCDEFGH" }, { auth: null });
    expect(res.status).toBe(500);
  });
});

describe("device-link — confirm", () => {
  it("401s with no Authorization header", async () => {
    arrange();
    const res = await post({ action: "confirm", code: "ABCDEFGH" }, { auth: null });
    expect(res.status).toBe(401);
  });

  it("401s when the JWT carries no claims", async () => {
    arrange({ claims: null });
    const res = await post({ action: "confirm", code: "ABCDEFGH" });
    expect(res.status).toBe(401);
  });

  it("attaches the CALLER'S OWN user_id from the JWT — never a client-supplied one", async () => {
    const client = arrange({
      claims: { sub: "real-caller-id" },
      tables: { device_link_codes: [{ id: "row-1", code: "ABCDEFGH", status: "pending", expires_at: FUTURE }] },
    });
    const res = await post({ action: "confirm", code: "ABCDEFGH" });
    expect(res.status).toBe(200);
    const write = client.writesTo("device_link_codes")[0];
    expect(write.payload).toMatchObject({ status: "confirmed", user_id: "real-caller-id" });
  });

  it("404s on an unknown code", async () => {
    arrange({ claims: { sub: "user-1" }, tables: { device_link_codes: [] } });
    const res = await post({ action: "confirm", code: "NOPE0000" });
    expect(res.status).toBe(404);
  });

  it("409s on a code that was already confirmed (single confirm, no re-binding to a different account)", async () => {
    arrange({
      claims: { sub: "attacker-id" },
      tables: {
        device_link_codes: [
          { id: "row-1", code: "ABCDEFGH", status: "confirmed", user_id: "original-user", expires_at: FUTURE },
        ],
      },
    });
    const res = await post({ action: "confirm", code: "ABCDEFGH" });
    expect(res.status).toBe(409);
  });

  it("410s and expires a code past its expiry rather than confirming it", async () => {
    const client = arrange({
      claims: { sub: "user-1" },
      tables: { device_link_codes: [{ id: "row-1", code: "ABCDEFGH", status: "pending", expires_at: PAST }] },
    });
    const res = await post({ action: "confirm", code: "ABCDEFGH" });
    expect(res.status).toBe(410);
    expect(client.writesTo("device_link_codes")[0].payload).toMatchObject({ status: "expired" });
  });
});

describe("device-link — validation", () => {
  it("400s on an invalid action", async () => {
    arrange();
    const res = await post({ action: "nonsense" }, { auth: null });
    expect(res.status).toBe(400);
  });

  it("400s on status/confirm with no code", async () => {
    arrange();
    const res = await post({ action: "status" }, { auth: null });
    expect(res.status).toBe(400);
  });
});
