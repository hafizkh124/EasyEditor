// @vitest-environment node
import { readFileSync } from "node:fs";

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
 */

const ingestBatch = readFileSync("supabase/functions/ingest-batch/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260823210000_delete_by_scope_rpc.sql", "utf8");

describe("ingest-batch delete-by-scope mode", () => {
  it("routes the mode to the delete-by-scope RPC", () => {
    expect(ingestBatch).toContain('mode === "delete-by-scope"');
    expect(ingestBatch).toContain("scholarly_documents_delete_by_scope");
  });

  it("requires exactly one row shaped { domain, collections: [non-empty] }", () => {
    const validation = ingestBatch.slice(0, ingestBatch.indexOf("// mode: \"delete-by-scope\""));
    expect(validation).toContain('mode === "delete-by-scope"');
    expect(validation).toMatch(/rows\.length !== 1/);
    expect(validation).toContain("collections.length === 0");
  });

  it("is not chunked — one scoped DELETE, not a per-row loop", () => {
    const handler = ingestBatch.slice(ingestBatch.indexOf('if (mode === "delete-by-scope")'), ingestBatch.indexOf('mode === "lookup-citation"'));
    expect(handler).not.toContain("CHUNK");
    expect(handler).not.toContain("for (");
  });
});

describe("scholarly_documents_delete_by_scope migration", () => {
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
