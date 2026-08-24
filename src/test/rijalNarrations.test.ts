// @vitest-environment node
import { readFileSync } from "node:fs";

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
 */

const ingestBatch = readFileSync("supabase/functions/ingest-batch/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260823200000_update_content_rpc.sql", "utf8");

describe("ingest-batch update-content mode", () => {
  it("routes the mode to the update-content RPC", () => {
    expect(ingestBatch).toContain('mode === "update-content"');
    expect(ingestBatch).toContain("scholarly_documents_update_content");
  });

  it("validates update-content rows under their own shape, not the insert shape", () => {
    // The insert branch demands domain/source_type/content. An update-content
    // payload has none of the first two, so falling through to it would 400
    // every request — exactly the bug update-citation hit before it got its
    // own branch.
    const validation = ingestBatch.slice(0, ingestBatch.indexOf("// mode: \"update-content\""));
    expect(validation).toContain('mode === "update-content"');
    expect(validation).toContain("passage_key");
  });

  it("rejects a blank content instead of erasing the row", () => {
    expect(ingestBatch).toMatch(/update-content[\s\S]{0,600}content\.trim\(\)\s*===\s*""/);
  });

  it("chunks the RPC call, like the other batch modes", () => {
    // Anchor on the handler's own comment banner, not on the mode string —
    // the first `mode === "update-content"` in the file is the validation
    // branch, which legitimately has no chunking.
    const handler = ingestBatch.slice(ingestBatch.indexOf('// mode: "update-content"'));
    expect(handler.slice(0, 1400)).toContain("CHUNK");
  });
});

describe("scholarly_documents_update_content migration", () => {
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
