// A fake `createClient` for testing Supabase Edge Functions.
//
// This is the dependency that stood between the test suite and everything past
// an edge function's auth wall: the replay check on `payment_reference`,
// `storagePath` ownership, and `autoApprove`'s writes to tier, expiry and token
// allocation. Those are the most consequential lines in the codebase and were
// completely untested.
//
// Two design decisions worth stating, because they are what make the tests
// trustworthy rather than merely green:
//
//  1. **It records writes rather than simulating a database.** The questions
//     these tests ask are "was the user given the tier they paid for", "was the
//     payment logged once", "was the wallet credited with the right number of
//     tokens". Those are assertions about the *calls made*, so the fake keeps an
//     ordered log of them. Modelling storage would add a second implementation
//     of Postgres to get wrong.
//  2. **Unconfigured reads return empty, not undefined.** A real
//     `.select()` that matches nothing resolves to `{ data: [], error: null }`.
//     Returning `undefined` would make production code take a nullish branch it
//     would never take against a real database, and the test would be proving
//     something false.

export interface FakeError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** One recorded mutation. */
export interface RecordedWrite {
  table: string;
  op: "insert" | "update" | "upsert" | "delete";
  payload: unknown;
  /** `.eq()` filters applied to the statement, in call order. */
  filters: Array<{ column: string; value: unknown }>;
  options?: unknown;
}

/** One recorded read. */
export interface RecordedRead {
  table: string;
  columns?: string;
  filters: Array<{ column: string; value: unknown }>;
}

export interface FakeSupabaseConfig {
  /** Claims returned by `auth.getClaims()`. `null` makes the call fail as unauthenticated. */
  claims?: Record<string, unknown> | null;
  authError?: FakeError;
  /** Rows a `.select()` on a given table resolves with. Defaults to `[]`. */
  tables?: Record<string, unknown[]>;
  /** Force a `.select()` on a table to fail. */
  selectErrors?: Record<string, FakeError>;
  /** Force a write to a table to fail. Keyed by table name. */
  writeErrors?: Record<string, FakeError>;
  /** Results for `.rpc(name, args)`. Defaults to `{ data: [], error: null }`. */
  rpc?: Record<string, { data?: unknown; error?: FakeError }>;
  /** What `storage.from(bucket).download(path)` resolves with. */
  storageDownload?: { data?: Blob | null; error?: FakeError };
}

export interface FakeClient {
  from(table: string): FakeBuilder;
  rpc(name: string, args?: unknown): Promise<{ data: unknown; error: FakeError | null }>;
  auth: { getClaims(token?: string): Promise<{ data: unknown; error: FakeError | null }> };
  storage: { from(bucket: string): { download(path: string): Promise<unknown> } };
  /** Every mutation, in the order the function issued it. */
  writes: RecordedWrite[];
  reads: RecordedRead[];
  rpcCalls: Array<{ name: string; args: unknown }>;
  storageDownloads: Array<{ bucket: string; path: string }>;
  /** Convenience: the writes issued against one table. */
  writesTo(table: string): RecordedWrite[];
}

type Result = { data: unknown; error: FakeError | null };

/**
 * Postgrest's builder is chainable and thenable — `await client.from(t).update(x).eq(c,v)`
 * resolves only because the builder itself is a promise. This mirrors that: the
 * filter methods return `this`, and `then` resolves the accumulated statement.
 */
class FakeBuilder implements PromiseLike<Result> {
  private op: RecordedWrite["op"] | "select" = "select";
  private payload: unknown = undefined;
  private options: unknown = undefined;
  private columns: string | undefined;
  private readonly filters: Array<{ column: string; value: unknown }> = [];
  private singleRow = false;

  constructor(
    private readonly table: string,
    private readonly config: FakeSupabaseConfig,
    private readonly client: FakeClient,
  ) {}

  select(columns?: string): this {
    // `.insert(…).select()` is a write that returns rows; only treat `select`
    // as the operation when nothing else has claimed it.
    if (this.op === "select") this.columns = columns;
    return this;
  }
  insert(payload: unknown): this {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: unknown): this {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: unknown, options?: unknown): this {
    this.op = "upsert";
    this.payload = payload;
    this.options = options;
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }
  // Filters this fake accepts but does not interpret. They are recorded via
  // `eq` semantics only; nothing under test branches on them yet.
  neq(column: string, value: unknown): this { return this.eq(column, value); }
  in(column: string, value: unknown): this { return this.eq(column, value); }
  or(expr: string): this { return this.eq("__or", expr); }
  ilike(column: string, value: unknown): this { return this.eq(column, value); }
  gte(column: string, value: unknown): this { return this.eq(column, value); }
  lte(column: string, value: unknown): this { return this.eq(column, value); }
  order(): this { return this; }
  limit(): this { return this; }
  single(): this { this.singleRow = true; return this; }
  maybeSingle(): this { this.singleRow = true; return this; }

  private resolve(): Result {
    if (this.op === "select") {
      this.client.reads.push({ table: this.table, columns: this.columns, filters: this.filters });
      const error = this.config.selectErrors?.[this.table];
      if (error) return { data: null, error };
      const rows = this.config.tables?.[this.table] ?? [];
      return { data: this.singleRow ? (rows[0] ?? null) : rows, error: null };
    }

    this.client.writes.push({
      table: this.table,
      op: this.op,
      payload: this.payload,
      filters: this.filters,
      options: this.options,
    });
    const error = this.config.writeErrors?.[this.table];
    return { data: error ? null : this.payload, error: error ?? null };
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

export function createFakeClient(config: FakeSupabaseConfig = {}): FakeClient {
  const client: FakeClient = {
    writes: [],
    reads: [],
    rpcCalls: [],
    storageDownloads: [],

    from(table: string) {
      return new FakeBuilder(table, config, client);
    },

    rpc(name: string, args?: unknown) {
      client.rpcCalls.push({ name, args });
      const result = config.rpc?.[name];
      return Promise.resolve({ data: result?.data ?? [], error: result?.error ?? null });
    },

    auth: {
      getClaims() {
        if (config.authError) return Promise.resolve({ data: null, error: config.authError });
        if (config.claims === null || config.claims === undefined) {
          // Matches supabase-js: an unverifiable token yields no claims rather
          // than throwing, and the caller is expected to 401 on that.
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: { claims: config.claims }, error: null });
      },
    },

    storage: {
      from(bucket: string) {
        return {
          download(path: string) {
            client.storageDownloads.push({ bucket, path });
            const configured = config.storageDownload;
            if (configured) {
              return Promise.resolve({
                data: configured.data ?? null,
                error: configured.error ?? null,
              });
            }
            return Promise.resolve({ data: null, error: { message: "not configured" } });
          },
        };
      },
    },

    writesTo(table: string) {
      return client.writes.filter((w) => w.table === table);
    },
  };

  return client;
}

/**
 * A `createClient` drop-in that hands out the same fake to every caller.
 *
 * Edge functions typically build two clients — one carrying the caller's JWT,
 * one with the service-role key. Sharing a single recorder keeps the assertions
 * about ordering meaningful ("the replay check happened before the download"),
 * which two separate fakes would lose.
 */
export function fakeCreateClient(config: FakeSupabaseConfig = {}) {
  const client = createFakeClient(config);
  const factory = () => client;
  return { client, factory };
}
