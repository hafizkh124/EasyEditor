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
//  3. **`.eq()`, `.neq()`, `.is()`, and the ordering comparisons genuinely
//     filter; `.in()`, `.or()`, `.ilike()` are recorded but not applied.** This was
//     not the original design — a first version ignored every filter and just
//     returned whatever rows a test configured for the table, which passed
//     every test written against it right up until verify-renewal-receipt's
//     tests, where the *same* `subscriptions` table is read twice in one
//     request (once for "does this user have an active plan", once for "has
//     this payment_reference been used before") and an unfiltered read made
//     the first row satisfy both — a seeded active subscription was silently
//     misread as a duplicate payment. Equality and ordering comparisons are
//     what the code under test actually relies on to tell rows apart for a
//     decision that matters — including check-subscription-expiry's own
//     documented claim of idempotency for already-downgraded users, which is
//     not a property a no-op filter can prove. `.in()`'s array membership and
//     `.or()`'s free-form expressions stay unimplemented because a fake
//     matcher for either would be more likely to hide a bug than reveal one.
//     Tests must scope `tables` narrowly enough that those specific methods
//     not filtering is safe.

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
  /**
   * User returned by `auth.getUser(token)` — the older, still-current auth
   * check some functions use instead of `getClaims()` (e.g. islamic-search).
   * `null` or omitted makes the call fail as unauthenticated.
   */
  user?: Record<string, unknown> | null;
  getUserError?: FakeError;
  /** Rows a `.select()` on a given table resolves with. Defaults to `[]`. */
  tables?: Record<string, unknown[]>;
  /** Force a `.select()` on a table to fail. */
  selectErrors?: Record<string, FakeError>;
  /** Force a write to a table to fail. Keyed by table name. */
  writeErrors?: Record<string, FakeError>;
  /**
   * Results for `.rpc(name, args)`. Defaults to `{ data: [], error: null }`.
   * A function form receives the call's `args` — needed when one RPC name is
   * called more than once with different arguments in the same request, e.g.
   * process-email-queue calls `read_email_batch` once per queue and expects a
   * different batch back each time.
   */
  rpc?: Record<
    string,
    { data?: unknown; error?: FakeError } | ((args: unknown) => { data?: unknown; error?: FakeError })
  >;
  /** What `storage.from(bucket).download(path)` resolves with. */
  storageDownload?: { data?: Blob | null; error?: FakeError };
}

export interface FakeClient {
  from(table: string): FakeBuilder;
  rpc(name: string, args?: unknown): Promise<{ data: unknown; error: FakeError | null }>;
  auth: {
    getClaims(token?: string): Promise<{ data: unknown; error: FakeError | null }>;
    getUser(token?: string): Promise<{ data: { user: unknown }; error: FakeError | null }>;
  };
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
type MatchOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "is";

const MATCHERS: Record<MatchOp, (rowValue: unknown, value: unknown) => boolean> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  // ISO date strings compare correctly with `<`; so do numbers. Nothing under
  // test filters on any other type.
  lt: (a, b) => (a as never) < (b as never),
  lte: (a, b) => (a as never) <= (b as never),
  gt: (a, b) => (a as never) > (b as never),
  gte: (a, b) => (a as never) >= (b as never),
  // Postgrest's `.is(col, null)` is IS NULL, which also catches a column
  // that is simply absent from the row object (JS `undefined`) — a fake row
  // built by omitting a field is meant to behave like a real NULL column,
  // not like a type error. `.is(col, true/false)` still needs strict
  // equality, since Postgres booleans have no such "absent means true"
  // reading.
  is: (a, b) => (b === null ? a === null || a === undefined : a === b),
};

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
  // Populated only by the filter methods listed as "applied for real" on
  // `matchers` below — see that comment for which ones and why.
  private readonly matchers: Array<{ column: string; value: unknown; op: MatchOp }> = [];
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

  /**
   * `.eq()`, `.neq()`, and the ordering comparisons narrow which rows a
   * `select()` resolves to — see `resolve()`. These are the filter methods
   * interpreted for real, because they are what the code under test relies on
   * to distinguish rows for a decision that matters: verify-receipt's replay
   * check needs `payment_reference` to actually match; check-subscription-expiry
   * needs `expires_at < now` and `tier != free` to actually exclude rows, since
   * its own docstring claims idempotency for already-downgraded users and that
   * is not a property a no-op filter can prove.
   */
  eq(column: string, value: unknown): this { return this.match("eq", column, value); }
  neq(column: string, value: unknown): this { return this.match("neq", column, value); }
  lt(column: string, value: unknown): this { return this.match("lt", column, value); }
  lte(column: string, value: unknown): this { return this.match("lte", column, value); }
  gt(column: string, value: unknown): this { return this.match("gt", column, value); }
  gte(column: string, value: unknown): this { return this.match("gte", column, value); }
  is(column: string, value: unknown): this { return this.match("is", column, value); }

  private match(op: MatchOp, column: string, value: unknown): this {
    this.filters.push({ column, value });
    this.matchers.push({ column, value, op });
    return this;
  }

  // Recorded for test assertions and for the query shape, but NOT applied when
  // resolving a select — a fake matcher for a partial-index `.or()` expression
  // or an `.in()` array would be more likely to hide a bug than reveal one, so
  // tests that depend on these must scope `tables` narrowly enough that it
  // doesn't matter which of these actually ran.
  in(column: string, value: unknown): this { this.filters.push({ column, value }); return this; }
  or(expr: string): this { this.filters.push({ column: "__or", value: expr }); return this; }
  ilike(column: string, value: unknown): this { this.filters.push({ column, value }); return this; }
  order(): this { return this; }
  limit(): this { return this; }
  single(): this { this.singleRow = true; return this; }
  maybeSingle(): this { this.singleRow = true; return this; }

  private resolve(): Result {
    if (this.op === "select") {
      this.client.reads.push({ table: this.table, columns: this.columns, filters: this.filters });
      const error = this.config.selectErrors?.[this.table];
      if (error) return { data: null, error };
      const allRows = this.config.tables?.[this.table] ?? [];
      const rows = this.matchers.length
        ? allRows.filter((row) =>
            this.matchers.every(({ column, value, op }) =>
              MATCHERS[op]((row as Record<string, unknown> | null)?.[column], value),
            ),
          )
        : allRows;
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
      const configured = config.rpc?.[name];
      const result = typeof configured === "function" ? configured(args) : configured;
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
      getUser() {
        if (config.getUserError) return Promise.resolve({ data: { user: null }, error: config.getUserError });
        return Promise.resolve({ data: { user: config.user ?? null }, error: null });
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
