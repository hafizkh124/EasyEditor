import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * SPEC-M4 NFR-5 / R2 — the personal corpus must never cross user boundaries.
 *
 * Every edge function that reaches `findCitations` (refine-text,
 * resource-search) builds its Supabase client with the SERVICE ROLE key, and
 * service_role bypasses RLS. So the owner-only policy on `library_chunks`
 * proves nothing about these two channels: the filter has to be in the query
 * the engine sends. These tests assert exactly that, at the engine boundary.
 */

// Deterministic, offline: no key ⇒ the planner falls back to its heuristic
// plan instead of calling a model.
vi.stubGlobal("Deno", { env: { get: () => undefined } });

// The vector channel bails out before the RPC when embedding fails, which
// would make the "passes filter_user_id" assertion vacuously pass.
vi.mock("../../supabase/functions/_shared/embed.ts", () => ({
  EMBED_MODEL: "gemini-embedding-001",
  EMBED_DIMS: 768,
  embedQuery: async () => new Array(768).fill(0.01),
  embedBatch: async () => [],
}));

type RpcCall = { fn: string; args: Record<string, unknown> };
type TableQuery = { table: string; filters: Record<string, unknown> };

function makeFakeSupabase() {
  const rpcCalls: RpcCall[] = [];
  const tableQueries: TableQuery[] = [];

  const builder = (table: string) => {
    const state: TableQuery = { table, filters: {} };
    // Every terminal (`limit`, `maybeSingle`, …) records the finished query.
    const api: Record<string, unknown> = {};
    const chain = () => api;
    Object.assign(api, {
      select: chain,
      gt: chain,
      order: chain,
      eq: (col: string, val: unknown) => {
        state.filters[col] = val;
        return api;
      },
      ilike: (col: string, val: unknown) => {
        state.filters[`ilike:${col}`] = val;
        return api;
      },
      limit: async () => {
        tableQueries.push(state);
        return { data: [], error: null };
      },
      maybeSingle: async () => {
        tableQueries.push(state);
        return { data: null, error: null };
      },
      upsert: async () => ({ data: null, error: null }),
    });
    return api;
  };

  return {
    rpcCalls,
    tableQueries,
    client: {
      from: (table: string) => builder(table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: [], error: null };
      },
    },
  };
}

// Imported after the mocks above are registered.
let findCitations: typeof import("../../supabase/functions/_shared/citationEngine")["findCitations"];

beforeAll(async () => {
  ({ findCitations } = await import("../../supabase/functions/_shared/citationEngine"));
});

const QUERY = "نماز میں خشوع کی اہمیت";
const USER_A = "11111111-1111-4111-8111-111111111111";

describe("Personal corpus isolation (SPEC-M4 NFR-5)", () => {
  it("never touches library_chunks when no userId is supplied", async () => {
    const fake = makeFakeSupabase();

    await findCitations({ query: QUERY, supabase: fake.client, rerank: false });

    expect(fake.rpcCalls.map((c) => c.fn)).not.toContain("match_library_chunks");
    expect(fake.tableQueries.map((q) => q.table)).not.toContain("library_chunks");
  });

  it("passes the owner to match_library_chunks when userId is supplied", async () => {
    const fake = makeFakeSupabase();

    await findCitations({ query: QUERY, supabase: fake.client, userId: USER_A, rerank: false });

    const call = fake.rpcCalls.find((c) => c.fn === "match_library_chunks");
    expect(call).toBeDefined();
    expect(call!.args.filter_user_id).toBe(USER_A);
  });

  it("filters the lexical personal channel by user_id", async () => {
    const fake = makeFakeSupabase();

    await findCitations({ query: QUERY, supabase: fake.client, userId: USER_A, rerank: false });

    const chunkQuery = fake.tableQueries.find((q) => q.table === "library_chunks");
    expect(chunkQuery).toBeDefined();
    expect(chunkQuery!.filters.user_id).toBe(USER_A);
  });
});
