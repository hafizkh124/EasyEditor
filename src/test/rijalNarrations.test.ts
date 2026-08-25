// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockNetwork, setDenoEnv } from "./helpers/denoShim";
import { createFakeClient, type FakeSupabaseConfig } from "./helpers/fakeSupabase";

/**
 * Guards the `update-content` wire contract that the rijal narration backfill
 * depends on.
 *
 * The Python extractor itself is exercised by running the backfill with
 * --dry-run (it re-parses 19,618 cached pages offline). What is worth pinning
 * in CI is the JS/SQL half: ingest-batch must actually route mode
 * "update-content", validate it under its own shape, and refuse a blank
 * content — because the RPC it calls SETs the column, so an accepted empty
 * string would erase a narrator's biography instead of updating it.
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

describe("ingest-batch update-content mode", () => {
  it("routes to scholarly_documents_update_content", async () => {
    const client = arrange({
      scholarly_documents_update_content: { data: [{ passage_key: "ibn-hajar-1", updated: true }] },
    });
    const res = await post({
      mode: "update-content",
      rows: [{ passage_key: "ibn-hajar-1", content: "روى عنه خمسمائة حديث" }],
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ processed: 1, updated: 1 });
    expect(client.rpcCalls[0]).toMatchObject({ name: "scholarly_documents_update_content" });
  });

  it("validates update-content rows under their own shape, not the insert shape", () => {
    // The insert branch demands domain/source_type/content. An update-content
    // payload has neither, so falling through to it would 400 every request
    // — exactly the bug update-citation hit before it got its own branch.
    arrange();
    return expect(
      post({
        mode: "update-content",
        rows: [{ passage_key: "ibn-hajar-1", content: "narration text" }],
      }).then((r) => r.status),
    ).resolves.toBe(200);
  });

  it("rejects a row missing passage_key even with valid content", async () => {
    arrange();
    const res = await post({ mode: "update-content", rows: [{ content: "narration text" }] });
    expect(res.status).toBe(400);
  });

  it("rejects a blank content instead of erasing the row", async () => {
    arrange();
    const res = await post({
      mode: "update-content",
      rows: [{ passage_key: "ibn-hajar-1", content: "   " }],
    });
    expect(res.status).toBe(400);
  });

  it("chunks the RPC call across CHUNK-sized batches, like the other batch modes", async () => {
    const client = arrange({
      scholarly_documents_update_content: (args: unknown) => ({
        data: ((args as { payload: unknown[] }).payload).map(() => ({ updated: true })),
      }),
    });
    const rows = Array.from({ length: 250 }, (_, i) => ({
      passage_key: `narrator-${i}`,
      content: `bio ${i}`,
    }));
    const res = await post({ mode: "update-content", rows });

    expect(res.status).toBe(200);
    // CHUNK = 100, so 250 rows must take 3 RPC calls (100 + 100 + 50), not 1.
    expect(client.rpcCalls.length).toBe(3);
    await expect(res.json()).resolves.toMatchObject({ processed: 250, updated: 250 });
  });
});

describe("scholarly_documents_update_content migration", () => {
  // The RPC body is SQL DDL/PLpgSQL, which a unit test cannot execute — this
  // stays a source-text assertion per TESTING-STRATEGY.md §6.
  const migration = readFileSync("supabase/migrations/20260823200000_update_content_rpc.sql", "utf8");

  it("keys on passage_key and merges rather than replaces citation_ref", () => {
    expect(migration).toContain("WHERE sd.passage_key = v_passage_key");
    expect(migration).toContain("COALESCE(sd.citation_ref, '{}'::jsonb) || v_patch");
  });

  it("refuses a null or blank content", () => {
    expect(migration).toContain("btrim(v_content) = ''");
  });

  it("treats a missing citation_ref_patch as a no-op merge", () => {
    // r->'citation_ref_patch' is SQL NULL when absent and JSON 'null' when
    // explicitly null; either reaching the || merge would blank the column.
    expect(migration).toContain("COALESCE(r->'citation_ref_patch', '{}'::jsonb)");
    expect(migration).toContain("IF v_patch = 'null'::jsonb THEN");
  });

  it("leaves source_url and embedding untouched", () => {
    const body = migration.slice(migration.indexOf("UPDATE public.scholarly_documents"));
    const setClause = body.slice(0, body.indexOf("WHERE"));
    expect(setClause).not.toContain("source_url");
    expect(setClause).not.toContain("embedding");
  });

  it("is service_role only, like every other ingest RPC", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.scholarly_documents_update_content(jsonb) FROM PUBLIC, anon, authenticated;");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.scholarly_documents_update_content(jsonb) TO service_role;");
  });
});
