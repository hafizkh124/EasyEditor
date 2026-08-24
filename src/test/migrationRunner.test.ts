// @vitest-environment node
// electron/db/migrations/runner.ts — versioned schema migrations with an
// automatic pre-migration backup (SPEC-M5 risk R14: "a backup that is
// silently incomplete is worse than no backup", which is why the source uses
// better-sqlite3's own `.backup()` rather than a raw file copy — WAL mode
// means a plain `fs.copyFileSync` of the main file can miss committed data
// still sitting in the `-wal` file).
//
// This runs against REAL temp SQLite files, not `:memory:` or a fake. The
// backup path specifically manipulates the filesystem — `fs.existsSync`,
// better-sqlite3's `.backup()` — so faking any of that would prove nothing
// about whether a real backup file actually appears on disk with real data
// in it. `runner.ts` only type-imports from `open.ts`
// (`import type { SqliteDatabase }`), which TypeScript erases at compile
// time, so this file has no runtime dependency on `electron` and needs no
// mock for it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

// Spied rather than fully replaced: every test except the failure-path ones
// below needs the real implementation, since it is what actually creates the
// tables the rest of this suite asserts on.
vi.mock("../../electron/db/schema.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../electron/db/schema.ts")>();
  return { ...actual, initializeDatabaseSchema: vi.fn(actual.initializeDatabaseSchema) };
});

import { runDatabaseMigrations } from "../../electron/db/migrations/runner.ts";
import { initializeDatabaseSchema } from "../../electron/db/schema.ts";

const initSchemaSpy = vi.mocked(initializeDatabaseSchema);

const tempDirs: string[] = [];

function freshDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "easyeditor-migration-test-"));
  tempDirs.push(dir);
  return join(dir, "workspace.sqlite");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function schemaVersion(db: Database.Database): number | null {
  const row = db
    .prepare("SELECT value FROM corpus_meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : null;
}

describe("a fresh install", () => {
  it("creates corpus_meta and records the latest migration version", async () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    try {
      await runDatabaseMigrations(db, dbPath);
      expect(schemaVersion(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("the RUNNER — not schema.ts's own fallback — is what records the version", async () => {
    // schema.ts's initializeDatabaseSchema has its own defensive fallback
    // (`if (!getMeta.get('schema_version')) setMeta.run('schema_version','1')`),
    // so with the real implementation this test and the one above cannot tell
    // apart "runner.ts wrote the version" from "schema.ts's fallback wrote it
    // instead" — removing runner.ts's own setVersionStmt.run() call is
    // invisible to both for a v1-only history, since v1's up() happens to
    // call initializeDatabaseSchema. Stubbing it out here (no schema_version
    // side effect at all) isolates runner.ts's own responsibility, which
    // matters for whatever migration is added after this one — a v2 that
    // does not itself touch corpus_meta would have no such safety net.
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    initSchemaSpy.mockImplementationOnce(() => undefined); // does nothing
    try {
      await runDatabaseMigrations(db, dbPath);
      expect(schemaVersion(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("actually applies the schema — a known table exists afterward", async () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    try {
      await runDatabaseMigrations(db, dbPath);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toContain("corpus_meta");
    } finally {
      db.close();
    }
  });

  it("does not create a backup file when the database did not exist before this call", async () => {
    // better-sqlite3's `new Database(path)` already creates the file on disk,
    // so to genuinely exercise "the file did not exist yet" this passes a
    // DIFFERENT, still-nonexistent path as `dbPath` — the two parameters are
    // independent in the function's signature, and createPreMigrationBackup
    // checks the `dbPath` argument specifically, not wherever `db` itself
    // happens to be backed by.
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    const neverExisted = join(tempDirs.at(-1)!, "does-not-exist.sqlite");
    try {
      await runDatabaseMigrations(db, neverExisted);
      const files = readdirSync(tempDirs.at(-1)!);
      expect(files.some((f) => f.includes(".bak."))).toBe(false);
    } finally {
      db.close();
    }
  });
});

describe("a pre-migration backup, for a database that already exists on disk", () => {
  it("creates a backup file before applying the pending migration", async () => {
    const dbPath = freshDbPath();
    // Seed a v0 database — corpus_meta with no schema_version row, but the
    // file genuinely exists on disk before migrations run, unlike the "fresh
    // install" cases above.
    const seed = new Database(dbPath);
    seed.exec("CREATE TABLE placeholder (id INTEGER PRIMARY KEY);");
    seed.close();
    expect(existsSync(dbPath)).toBe(true);

    const db = new Database(dbPath);
    try {
      await runDatabaseMigrations(db, dbPath);
      const files = readdirSync(tempDirs.at(-1)!);
      const backups = files.filter((f) => f.includes(".bak.v0."));
      expect(backups).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("the backup is a real, restorable SQLite file — not an empty or truncated one", async () => {
    // The whole point of using better-sqlite3's `.backup()` instead of a raw
    // file copy is WAL-safety: this proves the backup is actually queryable,
    // not just that a file with the right name appeared.
    const dbPath = freshDbPath();
    const seed = new Database(dbPath);
    seed.pragma("journal_mode = WAL");
    seed.exec("CREATE TABLE marker (id INTEGER PRIMARY KEY, note TEXT);");
    seed.prepare("INSERT INTO marker (note) VALUES (?)").run("pre-migration data");
    seed.close();

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    try {
      await runDatabaseMigrations(db, dbPath);
      const files = readdirSync(tempDirs.at(-1)!);
      const backupFile = files.find((f) => f.includes(".bak.v0."));
      expect(backupFile).toBeDefined();

      const backupDb = new Database(join(tempDirs.at(-1)!, backupFile!), { readonly: true });
      try {
        const row = backupDb.prepare("SELECT note FROM marker").get() as { note: string };
        expect(row.note).toBe("pre-migration data");
      } finally {
        backupDb.close();
      }
    } finally {
      db.close();
    }
  });
});

describe("idempotency — a database already at the current version", () => {
  it("does not create a second backup or bump the version again", async () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    try {
      await runDatabaseMigrations(db, dbPath); // v0 -> v1
      const filesAfterFirst = readdirSync(tempDirs.at(-1)!);

      await runDatabaseMigrations(db, dbPath); // already v1
      const filesAfterSecond = readdirSync(tempDirs.at(-1)!);

      expect(filesAfterSecond.length).toBe(filesAfterFirst.length);
      expect(schemaVersion(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("still ensures the base schema exists even with nothing pending", async () => {
    // The `pendingMigrations.length === 0` branch calls
    // initializeDatabaseSchema(db) as a safety net rather than returning
    // immediately — this is what that net actually catches: a database
    // already at the latest recorded version whose schema was somehow
    // dropped or never fully created. Drop a table `initializeDatabaseSchema`
    // creates but this test does NOT recreate itself (`projects`, not
    // `corpus_meta`, which the very next line would otherwise trivially
    // satisfy regardless of whether the safety net ran at all) — only the
    // net's own second call can bring it back.
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    try {
      await runDatabaseMigrations(db, dbPath);
      db.exec("DROP TABLE projects;");
      expect(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>)
          .map((t) => t.name),
      ).not.toContain("projects");

      await runDatabaseMigrations(db, dbPath); // schema_version is still 1: nothing pending
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).toContain("projects");
    } finally {
      db.close();
    }
  });
});

describe("a migration that fails", () => {
  // v1's `up()` calls initializeDatabaseSchema(db) — spied above — so making
  // that one call throw exercises the real transaction-rollback path without
  // needing to inject a fake migration into the private MIGRATIONS array.
  afterEach(() => {
    initSchemaSpy.mockRestore();
  });

  it("propagates the error rather than swallowing it", async () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    initSchemaSpy.mockImplementationOnce(() => {
      throw new Error("disk full mid-migration");
    });
    try {
      await expect(runDatabaseMigrations(db, dbPath)).rejects.toThrow("disk full mid-migration");
    } finally {
      db.close();
    }
  });

  it("rolls back schema_version — a failed migration must not look applied", async () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    initSchemaSpy.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    try {
      await expect(runDatabaseMigrations(db, dbPath)).rejects.toThrow();
      expect(schemaVersion(db)).toBeNull();
    } finally {
      db.close();
    }
  });

  it("rolls back partial DDL work from inside the failed migration, not just the version stamp", async () => {
    // The previous test's failure point (throwing before any DDL runs) cannot
    // actually distinguish "wrapped in db.transaction()" from "not wrapped" —
    // setVersionStmt.run() is simply never reached either way, since it is
    // sequential code after the throw. This is the test that can: the mock
    // does a real, observable side effect (a table create) INSIDE up() before
    // throwing, so whether that table survives is genuine evidence of whether
    // the transaction boundary is real. SQLite auto-commits each statement
    // when there is no ambient transaction, so without db.transaction() this
    // table would still be there after the throw — a half-migrated database,
    // which is exactly what SPEC-M5 risk R14 is about.
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    initSchemaSpy.mockImplementationOnce((innerDb: Database.Database) => {
      innerDb.exec("CREATE TABLE mid_migration_marker (id INTEGER);");
      throw new Error("boom after partial DDL");
    });
    try {
      await expect(runDatabaseMigrations(db, dbPath)).rejects.toThrow();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      expect(tables.map((t) => t.name)).not.toContain("mid_migration_marker");
    } finally {
      db.close();
    }
  });

  it("still leaves the pre-migration backup in place — the failure does not destroy the safety net", async () => {
    const dbPath = freshDbPath();
    const seed = new Database(dbPath);
    seed.exec("CREATE TABLE placeholder (id INTEGER PRIMARY KEY);");
    seed.close();

    const db = new Database(dbPath);
    initSchemaSpy.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    try {
      await expect(runDatabaseMigrations(db, dbPath)).rejects.toThrow();
      const files = readdirSync(tempDirs.at(-1)!);
      expect(files.some((f) => f.includes(".bak.v0."))).toBe(true);
    } finally {
      db.close();
    }
  });

  it("a retry after fixing the underlying problem succeeds normally", async () => {
    const dbPath = freshDbPath();
    const db = new Database(dbPath);
    initSchemaSpy.mockImplementationOnce(() => {
      throw new Error("transient failure");
    });
    await expect(runDatabaseMigrations(db, dbPath)).rejects.toThrow();

    // No mockImplementationOnce queued this time — falls through to the real
    // (spied-but-not-replaced) implementation.
    try {
      await runDatabaseMigrations(db, dbPath);
      expect(schemaVersion(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});
