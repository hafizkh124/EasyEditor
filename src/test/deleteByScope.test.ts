// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockNetwork, setDenoEnv } from "./helpers/denoShim";
import { createFakeClient, type FakeSupabaseConfig } from "./helpers/fakeSupabase";

/**
 * scholarly_documents_delete_by_scope is the first DESTRUCTIVE ingest RPC in
 * the project — every other one (update-content, update-citation, insert)
 * only adds or patches. Built to retire the 11 tohed-hadith books superseded
 * by a better-sourced IUB copy (full tashkeel matn, hukm, takhreej, isnad —
 * 2026-08-23 Arabic-gap backfill).
 *
 * The one property worth pinning hardest: 9 of those 11 books share their
 * exact collection slug between the old tohed-hadith row and the new
 * islamicurdubooks-hadith row (collections.ts's arabicMatn split documents
 * this). A collection-only filter would delete both in one statement. These
 * tests exist to make that specific mistake impossible to reintroduce.
 *
 * The ingest-batch half now calls `handle(req)` directly (exported since P1's
 * G2 work) instead of asserting on source text — see TESTING-STRATEGY.md §6.
 * The RPC's own SQL still can't be executed by a unit test, so that half
 * stays a source-text assertion.
 */

const state = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: () => state.client,
}));

type Handler = (req: Request) => Promise<Response>;
let handle: Handler;
let restoreNetwork: () => void;
let restoreSecret: () => void;

const SECRET = "test-ingest-shared-secret";

beforeAll(async () => {
  restoreNetwork = blockNetwork();
  restoreSecret = setDenoEnv("INGEST_SHARED_SECRET", SECRET);
  ({ handle } = await import("../../supabase/functions/ingest-batch/index.ts"));
}, 60_000);

afterAll(() => {
  restoreNetwork?.();
  restoreSecret?.();
});

function arrange(rpc: FakeSupabaseConfig["rpc"] = {}) {
  const client = createFakeClient({ rpc });
  state.client = client;
  return client;
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return handle(
    new Request("https://fn.test/ingest-batch", {
      method: "POST",
      headers: { "x-ingest-secret": SECRET, "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("ingest-batch delete-by-scope mode", () => {
  it("rejects the request without the shared secret", async () => {
    arrange();
    const res = await post(
      { mode: "delete-by-scope", rows: [{ domain: "tohed-hadith", collections: ["sahih-ibn-hibban"] }] },
      { "x-ingest-secret": "wrong" },
    );
    expect(res.status).toBe(401);
  });

  it("routes to scholarly_documents_delete_by_scope with p_domain/p_collections", async () => {
    const client = arrange({
      scholarly_documents_delete_by_scope: { data: [{ id: "1" }, { id: "2" }] },
    });
    const res = await post({
      mode: "delete-by-scope",
      rows: [{ domain: "tohed-hadith", collections: ["sahih-ibn-hibban"] }],
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ deleted: 2 });
    expect(client.rpcCalls).toEqual([
      {
        name: "scholarly_documents_delete_by_scope",
        args: { p_domain: "tohed-hadith", p_collections: ["sahih-ibn-hibban"] },
      },
    ]);
  });

  it("requires exactly one row shaped { domain, collections: [non-empty] }", async () => {
    arrange();

    await expect(
      post({ mode: "delete-by-scope", rows: [{ collections: ["sahih-ibn-hibban"] }] }).then((r) => r.status),
    ).resolves.toBe(400);

    await expect(
      post({ mode: "delete-by-scope", rows: [{ domain: "tohed-hadith", collections: [] }] }).then((r) => r.status),
    ).resolves.toBe(400);

    await expect(
      post({
        mode: "delete-by-scope",
        rows: [
          { domain: "tohed-hadith", collections: ["a"] },
          { domain: "tohed-hadith", collections: ["b"] },
        ],
      }).then((r) => r.status),
    ).resolves.toBe(400);
  });

  it("issues exactly one RPC call regardless of how many collections are scoped — not a per-row loop", async () => {
    const client = arrange({ scholarly_documents_delete_by_scope: { data: [] } });
    await post({
      mode: "delete-by-scope",
      rows: [{ domain: "tohed-hadith", collections: ["a", "b", "c", "d", "e"] }],
    });
    expect(client.rpcCalls.length).toBe(1);
  });
});

describe("scholarly_documents_delete_by_scope migration", () => {
  // The RPC body is SQL DDL/PLpgSQL, which a unit test cannot execute — this
  // stays a source-text assertion per TESTING-STRATEGY.md §6.
  const migration = readFileSync("supabase/migrations/20260823210000_delete_by_scope_rpc.sql", "utf8");

  it("requires domain, never deletes by collection alone", () => {
    // This is the load-bearing invariant: 9 of the 11 replaced books share
    // their exact collection slug (e.g. "sahih-ibn-hibban") between
    // tohed-hadith and islamicurdubooks-hadith. Only the domain column tells
    // them apart.
    expect(migration).toContain("sd.domain = p_domain");
    expect(migration).toContain("(sd.citation_ref->>'collection') = ANY (p_collections)");
    expect(migration).toContain("p_domain IS NULL OR btrim(p_domain) = ''");
  });

  it("refuses an empty or null collections array", () => {
    // Without this guard, a missing/empty argument would DELETE the ENTIRE
    // domain — including the 3 tohed-hadith books that keep their copy
    // (musannaf-ibn-abi-shaybah, mishkat-al-masabih, sahih-adab-al-mufrad)
    // because no other domain replaces them.
    expect(migration).toContain("array_length(p_collections, 1) IS NULL");
    expect(migration).toMatch(/RAISE EXCEPTION[\s\S]{0,80}p_collections/);
  });

  it("returns an audit trail of every deleted row", () => {
    expect(migration).toMatch(/RETURNING sd\.id, sd\.passage_key, sd\.source_url/);
  });

  it("is service_role only", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.scholarly_documents_delete_by_scope(text, text[]) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.scholarly_documents_delete_by_scope(text, text[]) TO service_role;");
  });
});
