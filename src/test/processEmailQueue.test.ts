// @vitest-environment node
// process-email-queue — drains two pgmq queues (auth_emails first, then
// transactional_emails) through the Lovable email API, with retry/DLQ and
// rate-limit handling in between.
//
// The properties worth proving here are the ones a broken deploy would get
// wrong silently: a message that sends successfully must not be sent twice
// (the dedup guard), a message that keeps failing must eventually stop being
// retried forever (MAX_RETRIES → DLQ) rather than blocking the queue forever,
// and a 429 from the email API must stop the whole run rather than burning
// through the rest of the batch into the same rate limit.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { blockNetwork, setDenoEnv } from "./helpers/denoShim";
import { createFakeClient, type FakeClient } from "./helpers/fakeSupabase";

const state = vi.hoisted(() => ({
  client: null as unknown,
  sendImpl: null as unknown,
}));

vi.mock("npm:@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

vi.mock("npm:@lovable.dev/email-js", () => ({
  sendLovableEmail: (...args: unknown[]) => (state.sendImpl as (...a: unknown[]) => unknown)(...args),
}));

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
let restoreNetwork: () => void;
let restoreKey: () => void;

// TTL expiry is computed against `Date.now()`, so the fixtures below are
// written relative to a fixed NOW rather than the real wall clock — pinning
// the literal to what the real clock happened to read at write time makes
// the TTL tests pass or fail depending purely on when `vitest` is invoked.
//
// This pins only `Date.now()`, deliberately NOT via `vi.useFakeTimers()`.
// The handler awaits a real `setTimeout` between messages in the same batch
// (the send-rate smoothing delay); full fake timers freeze that too, and
// since nothing here calls `vi.advanceTimersByTime()`, every multi-message
// test would hang forever waiting on a delay that never fires.
const NOW = "2026-08-24T12:00:00.000Z";
let dateNowSpy: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.parse(NOW));
  // Not in denoShim's DEFAULT_ENV — the handler 500s on "Server configuration
  // error" without it, before reaching any of the logic under test.
  restoreKey = setDenoEnv("LOVABLE_API_KEY", "test-lovable-key");
  ({ handle } = await import("../../supabase/functions/process-email-queue/index.ts"));
}, 60_000);

afterAll(() => {
  restoreNetwork?.();
  restoreKey?.();
  dateNowSpy?.mockRestore();
});

/** A base64url-encoded, unsigned-but-parseable JWT — parseJwtClaims only decodes, never verifies. */
function fakeJwt(claims: Record<string, unknown>): string {
  const seg = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  return `${seg({ alg: "none" })}.${seg(claims)}.sig`;
}

const SERVICE_ROLE_JWT = fakeJwt({ role: "service_role" });

/**
 * A pgmq batch row for one email. `message` is pulled out of `over` and
 * merged separately, and applied LAST in the returned object — spreading
 * `...over` after setting `message` would otherwise let `over.message`
 * silently clobber the merged one wholesale (wiping `queued_at`, `to`, etc.
 * down to just whatever the caller passed), so a customization as small as
 * `{ message: { message_id: "a" } }` would drop `queued_at` and the handler
 * would fall back to the batch row's `enqueued_at` instead — which is over an
 * hour before NOW in these fixtures, so every such message read as
 * TTL-expired and never reached the code path the test meant to exercise.
 */
const emailMsg = (over: Record<string, unknown> = {}) => {
  const { message: messageOver, ...rest } = over;
  return {
    msg_id: 1,
    read_ct: 1,
    enqueued_at: "2026-08-24T11:00:00.000Z", // 1h before NOW
    ...rest,
    message: {
      message_id: "msg-1",
      to: "user@example.com",
      from: "noreply@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      label: "welcome",
      queued_at: "2026-08-24T11:59:00.000Z", // 1min before NOW
      ...(messageOver as Record<string, unknown> | undefined),
    },
  };
};

/** email_send_state's one configuration row. Zero delay keeps tests fast. */
const stateRow = (over: Record<string, unknown> = {}) => ({
  retry_after_until: null,
  batch_size: 10,
  send_delay_ms: 0,
  auth_email_ttl_minutes: 15,
  transactional_email_ttl_minutes: 60,
  ...over,
});

/**
 * Wires up the fake with an empty batch for both queues by default, and lets
 * each test override just the queue(s) it cares about.
 */
function arrange(over: {
  emailSendState?: Record<string, unknown>;
  authBatch?: unknown[];
  transactionalBatch?: unknown[];
  emailSendLog?: unknown[];
  rpcErrors?: Record<string, { message: string }>;
} = {}): FakeClient {
  const client = createFakeClient({
    tables: {
      email_send_state: [over.emailSendState ?? stateRow()],
      email_send_log: over.emailSendLog ?? [],
    },
    rpc: {
      read_email_batch: (args: unknown) => {
        const queue = (args as { queue_name?: string } | undefined)?.queue_name;
        if (over.rpcErrors?.read_email_batch) return { error: over.rpcErrors.read_email_batch };
        if (queue === "auth_emails") return { data: over.authBatch ?? [] };
        if (queue === "transactional_emails") return { data: over.transactionalBatch ?? [] };
        return { data: [] };
      },
      delete_email: () => ({ data: null }),
      move_to_dlq: () => ({ data: null }),
    },
  });
  state.client = client;
  return client;
}

const post = () =>
  handle(
    new Request("https://fn.test/process-email-queue", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE_JWT}` },
    }),
  );

beforeEach(() => {
  state.sendImpl = () => Promise.resolve({ id: "sent-ok" });
});

describe("gating", () => {
  it("returns 500 when required env vars are missing", async () => {
    const restore = setDenoEnv("LOVABLE_API_KEY", undefined);
    try {
      arrange();
      const res = await post();
      expect(res.status).toBe(500);
    } finally {
      restore();
    }
  });

  it("rejects a request with no Authorization header", async () => {
    arrange();
    const res = await handle(new Request("https://fn.test/", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rejects a non-service-role JWT even though it is well-formed", async () => {
    arrange();
    const res = await handle(
      new Request("https://fn.test/", {
        method: "POST",
        headers: { Authorization: `Bearer ${fakeJwt({ role: "authenticated" })}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a token that does not even decode as a JWT", async () => {
    arrange();
    const res = await handle(
      new Request("https://fn.test/", { method: "POST", headers: { Authorization: "Bearer not-a-jwt" } }),
    );
    expect(res.status).toBe(403);
  });

  it("skips entirely while a rate-limit cooldown is active, without reading any queue", async () => {
    const client = arrange({ emailSendState: stateRow({ retry_after_until: "2099-01-01T00:00:00.000Z" }) });
    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ skipped: true, reason: "rate_limited" });
    expect(client.rpcCalls).toEqual([]);
  });

  it("proceeds once a past cooldown has elapsed", async () => {
    const client = arrange({ emailSendState: stateRow({ retry_after_until: "2000-01-01T00:00:00.000Z" }) });
    await post();
    expect(client.rpcCalls.some((c) => c.name === "read_email_batch")).toBe(true);
  });
});

describe("a successful send", () => {
  it("sends, logs it, deletes the message, and counts it as processed", async () => {
    const client = arrange({ authBatch: [emailMsg()] });
    const res = await post();

    await expect(res.json()).resolves.toEqual({ processed: 1 });

    const log = client.writesTo("email_send_log");
    expect(log).toHaveLength(1);
    expect(log[0].payload).toMatchObject({ message_id: "msg-1", status: "sent" });

    const deletes = client.rpcCalls.filter((c) => c.name === "delete_email");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].args).toMatchObject({ queue_name: "auth_emails", message_id: 1 });
  });

  it("processes auth_emails before transactional_emails", async () => {
    const client = arrange({
      authBatch: [emailMsg({ msg_id: 1, message: { message_id: "auth-1" } })],
      transactionalBatch: [emailMsg({ msg_id: 2, message: { message_id: "txn-1" } })],
    });
    await post();

    const batchCalls = client.rpcCalls.filter((c) => c.name === "read_email_batch");
    expect(batchCalls.map((c) => (c.args as { queue_name: string }).queue_name)).toEqual([
      "auth_emails",
      "transactional_emails",
    ]);
  });

  it("processes every message in a batch, not just the first", async () => {
    const client = arrange({
      authBatch: [
        emailMsg({ msg_id: 1, message: { message_id: "m1" } }),
        emailMsg({ msg_id: 2, message: { message_id: "m2" } }),
        emailMsg({ msg_id: 3, message: { message_id: "m3" } }),
      ],
    });
    const res = await post();
    await expect(res.json()).resolves.toEqual({ processed: 3 });
    expect(client.writesTo("email_send_log")).toHaveLength(3);
  });
});

describe("TTL expiry", () => {
  it("moves an expired auth email straight to the DLQ without sending it", async () => {
    const sent = vi.fn();
    state.sendImpl = sent;
    const client = arrange({
      authBatch: [
        emailMsg({
          message: { message_id: "stale-1", queued_at: "2026-08-24T00:00:00.000Z" }, // 12h before NOW, TTL 15min
        }),
      ],
    });
    const res = await post();

    expect(sent).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ processed: 0 });
    expect(client.rpcCalls.some((c) => c.name === "move_to_dlq")).toBe(true);
    expect(client.writesTo("email_send_log")[0].payload).toMatchObject({ status: "dlq" });
  });

  it("does not expire a fresh message against the same TTL", async () => {
    const sent = vi.fn().mockResolvedValue({ id: "ok" });
    state.sendImpl = sent;
    const client = arrange({
      authBatch: [emailMsg({ message: { message_id: "fresh-1", queued_at: "2026-08-24T11:59:00.000Z" } })], // 1min before NOW
    });
    await post();

    expect(sent).toHaveBeenCalled();
    expect(client.rpcCalls.some((c) => c.name === "move_to_dlq")).toBe(false);
  });

  it("applies the longer transactional TTL, not the auth TTL, to that queue", async () => {
    // 45 minutes old: past the 15-minute auth TTL, well inside the 60-minute
    // transactional TTL from the same stateRow() default.
    const sent = vi.fn().mockResolvedValue({ id: "ok" });
    state.sendImpl = sent;
    const client = arrange({
      transactionalBatch: [
        emailMsg({ message: { message_id: "txn-1", queued_at: "2026-08-24T11:15:00.000Z" } }), // 45min before NOW
      ],
    });
    await post();

    expect(sent).toHaveBeenCalled();
    expect(client.rpcCalls.some((c) => c.name === "move_to_dlq")).toBe(false);
  });
});

describe("retry budget", () => {
  it("moves a message to the DLQ once its failed-attempt count reaches MAX_RETRIES, without another send attempt", async () => {
    const sent = vi.fn();
    state.sendImpl = sent;
    const failedRows = Array.from({ length: 5 }, () => ({ message_id: "flaky-1", status: "failed" }));
    const client = arrange({
      authBatch: [emailMsg({ message: { message_id: "flaky-1" } })],
      emailSendLog: failedRows,
    });
    await post();

    expect(sent).not.toHaveBeenCalled();
    expect(client.rpcCalls.some((c) => c.name === "move_to_dlq")).toBe(true);
  });

  it("still attempts a send below the retry ceiling", async () => {
    const sent = vi.fn().mockResolvedValue({ id: "ok" });
    state.sendImpl = sent;
    const failedRows = Array.from({ length: 4 }, () => ({ message_id: "flaky-2", status: "failed" }));
    arrange({
      authBatch: [emailMsg({ message: { message_id: "flaky-2" } })],
      emailSendLog: failedRows,
    });
    await post();

    expect(sent).toHaveBeenCalled();
  });
});

describe("duplicate-send guard", () => {
  it("skips and dequeues a message already logged as sent, without sending it again", async () => {
    const sent = vi.fn();
    state.sendImpl = sent;
    const client = arrange({
      authBatch: [emailMsg({ message: { message_id: "dup-1" } })],
      emailSendLog: [{ id: 1, message_id: "dup-1", status: "sent" }],
    });
    const res = await post();

    expect(sent).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ processed: 0 });
    expect(client.rpcCalls.some((c) => c.name === "delete_email")).toBe(true);
    // No new log entry — the existing "sent" record is not duplicated either.
    expect(client.writesTo("email_send_log")).toEqual([]);
  });

  it("does not treat a FAILED prior attempt for the same message as a duplicate", async () => {
    const sent = vi.fn().mockResolvedValue({ id: "ok" });
    state.sendImpl = sent;
    arrange({
      authBatch: [emailMsg({ message: { message_id: "retry-1" } })],
      emailSendLog: [{ id: 1, message_id: "retry-1", status: "failed" }],
    });
    await post();
    expect(sent).toHaveBeenCalled();
  });
});

describe("send failures", () => {
  it("on a 429, logs rate_limited, sets a cooldown, and stops the whole run", async () => {
    state.sendImpl = () => Promise.reject({ status: 429, retryAfterSeconds: 120 });
    const client = arrange({
      authBatch: [
        emailMsg({ msg_id: 1, message: { message_id: "a" } }),
        emailMsg({ msg_id: 2, message: { message_id: "b" } }),
      ],
      transactionalBatch: [emailMsg({ msg_id: 3, message: { message_id: "c" } })],
    });
    const res = await post();

    await expect(res.json()).resolves.toEqual({ processed: 0, stopped: "rate_limited" });
    expect(client.writesTo("email_send_log")[0].payload).toMatchObject({ status: "rate_limited" });
    expect(client.writesTo("email_send_state")[0].payload).toHaveProperty("retry_after_until");
    // The second auth message and the entire transactional queue never ran.
    expect(client.rpcCalls.filter((c) => c.name === "read_email_batch")).toHaveLength(1);
  });

  it("on a 403, moves the message to the DLQ and stops the whole run", async () => {
    state.sendImpl = () => Promise.reject({ status: 403 });
    const client = arrange({
      authBatch: [
        emailMsg({ msg_id: 1, message: { message_id: "a" } }),
        emailMsg({ msg_id: 2, message: { message_id: "b" } }),
      ],
    });
    const res = await post();

    await expect(res.json()).resolves.toEqual({ processed: 0, stopped: "forbidden" });
    expect(client.rpcCalls.some((c) => c.name === "move_to_dlq")).toBe(true);
    // The second message in the same batch is never reached.
    expect(client.rpcCalls.filter((c) => c.name === "delete_email")).toEqual([]);
  });

  it("on any other failure, logs it as failed and continues to the next message", async () => {
    let calls = 0;
    state.sendImpl = () => {
      calls++;
      return calls === 1 ? Promise.reject(new Error("upstream 500")) : Promise.resolve({ id: "ok" });
    };
    const client = arrange({
      authBatch: [
        emailMsg({ msg_id: 1, message: { message_id: "a" } }),
        emailMsg({ msg_id: 2, message: { message_id: "b" } }),
      ],
    });
    const res = await post();

    await expect(res.json()).resolves.toEqual({ processed: 1 });
    expect(client.writesTo("email_send_log")[0].payload).toMatchObject({ status: "failed" });
    expect(client.writesTo("email_send_log")[1].payload).toMatchObject({ status: "sent" });
  });
});

describe("failures reading a queue", () => {
  it("skips a queue whose read fails, but still processes the other one", async () => {
    const sent = vi.fn().mockResolvedValue({ id: "ok" });
    state.sendImpl = sent;
    const client = createFakeClient({
      tables: { email_send_state: [stateRow()], email_send_log: [] },
      rpc: {
        // auth_emails' read fails; transactional_emails' read succeeds with a
        // real message — proves the loop's `continue` on a read error does not
        // abandon the run, only that one queue's turn.
        read_email_batch: (args: unknown) => {
          const queue = (args as { queue_name?: string }).queue_name;
          if (queue === "auth_emails") return { error: { message: "pgmq unavailable" } };
          return { data: [emailMsg({ message: { message_id: "txn-1" } })] };
        },
        delete_email: () => ({ data: null }),
        move_to_dlq: () => ({ data: null }),
      },
    });
    state.client = client;

    const res = await post();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ processed: 1 });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("does not throw when a queue's read returns no messages at all", async () => {
    arrange({ authBatch: [], transactionalBatch: [] });
    const res = await post();
    await expect(res.json()).resolves.toEqual({ processed: 0 });
  });
});
