// @vitest-environment node
// HTTP-layer tests for corpus-reads — the server-side route for three reads
// the browser lost when the corpus tables' "any signed-in user" read policies
// were dropped. Checks who may ask, that input is validated before any query,
// and that the admin-only action stays admin-only. The Supabase REST/auth
// calls are stubbed at `fetch`.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import "./helpers/denoShim";

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
const realFetch = globalThis.fetch;

let adminIds = new Set<string>();
const queries: string[] = [];

const jsonRes = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

beforeAll(async () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (url.pathname.endsWith("/auth/v1/user")) {
      if (auth === "Bearer user-token") return jsonRes({ id: "u-normal", aud: "authenticated" });
      if (auth === "Bearer admin-token") return jsonRes({ id: "u-admin", aud: "authenticated" });
      return jsonRes({ msg: "invalid" }, 401);
    }
    queries.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/user_roles")) {
      const uid = url.searchParams.get("user_id")?.replace("eq.", "") ?? "";
      return jsonRes(adminIds.has(uid) ? { role: "admin" } : null);
    }
    if (url.pathname.endsWith("/passage_translations")) {
      return jsonRes([{ passage_key: "quran:2:255", translator_slug: "x", text: "آیت الکرسی", translators: { full_name: "X" } }]);
    }
    if (url.pathname.endsWith("/scholarly_documents")) {
      return jsonRes([{ citation_ref: { rawy_id: 7, name_ar: "أبو هريرة" }, source_url: "https://u", title: "t" }]);
    }
    if (url.pathname.endsWith("/api_response_cache")) {
      return jsonRes([], 200, { "Content-Range": "0-0/42" });
    }
    return jsonRes([]);
  }) as typeof fetch;
  ({ handle } = await import("../../supabase/functions/corpus-reads/index.ts"));
}, 60_000);

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  adminIds = new Set(["u-admin"]);
  queries.length = 0;
});

const call = (body: unknown, token: string | null = "user-token") =>
  handle(
    new Request("https://fn.test/corpus-reads", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

describe("corpus-reads", () => {
  it("refuses a request with no sign-in, or a bad token, before any query", async () => {
    expect((await call({ action: "narrator-names", rawyIds: [7] }, null)).status).toBe(401);
    expect((await call({ action: "narrator-names", rawyIds: [7] }, "bogus")).status).toBe(401);
    expect(queries).toEqual([]);
  });

  it("rejects bad JSON and unknown actions", async () => {
    expect((await call("{ nope")).status).toBe(400);
    expect((await call({ action: "drop-table" })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });

  it("passage-translations: validates the key and language, then reads", async () => {
    expect((await call({ action: "passage-translations", passageKey: "quran:2:255; drop", language: "ur" })).status).toBe(400);
    expect((await call({ action: "passage-translations", passageKey: "quran:2:255", language: "ur'--" })).status).toBe(400);
    expect(queries).toEqual([]);
    const res = await call({ action: "passage-translations", passageKey: "quran:2:255", language: "ur" });
    expect(res.status).toBe(200);
    expect((await res.json()).rows[0].text).toBe("آیت الکرسی");
    expect(queries.some((q) => q.includes("passage_translations") && q.includes("limit=5"))).toBe(true);
  });

  it("narrator-names: keeps only positive whole numbers, at most 100, and de-duplicates", async () => {
    const ids = [7, 7, -1, 0, 2.5, "x", ...Array.from({ length: 200 }, (_, i) => i + 10)];
    const res = await call({ action: "narrator-names", rawyIds: ids });
    expect(res.status).toBe(200);
    const q = decodeURIComponent(queries.find((x) => x.includes("scholarly_documents")) ?? "");
    expect(q).toContain("domain=eq.islamicurdubooks-rijal");
    const list = /in\.\(([^)]*)\)/.exec(q)?.[1].split(",") ?? [];
    expect(list.length).toBe(100);
    expect(list[0]).toBe("7");
    expect(new Set(list).size).toBe(100);
    expect(list.every((n) => /^[1-9]\d*$/.test(n))).toBe(true);
  });

  it("narrator-names: nothing valid means no query", async () => {
    const res = await call({ action: "narrator-names", rawyIds: ["a", -3] });
    expect(await res.json()).toEqual({ rows: [] });
    expect(queries).toEqual([]);
  });

  it("cache-count is for admins only", async () => {
    const denied = await call({ action: "cache-count" }, "user-token");
    expect(denied.status).toBe(403);
    expect(queries.some((q) => q.includes("api_response_cache"))).toBe(false);
    const ok = await call({ action: "cache-count" }, "admin-token");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ count: 42 });
  });
});
