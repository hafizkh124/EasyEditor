// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { addSearch, listSearches, removeSearch, clearSearches } from "../../electron/db/workspaceStore/searchHistory";

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE corpus_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO corpus_meta (key, value) VALUES ('local_user_id', 'local-user');
    CREATE TABLE search_history (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, query TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}', result_count INTEGER, created_at TEXT NOT NULL
    );
  `);
});

describe("offline search_history", () => {
  it("records and lists newest-first", () => {
    addSearch(db, { kind: "shamela", query: "نية", resultCount: 3 });
    addSearch(db, { kind: "jkhssn", query: "شعبة", resultCount: 1 });
    const rows = listSearches(db);
    expect(rows.map((r) => r.query)).toEqual(["شعبة", "نية"]);
    expect(rows[1]).toMatchObject({ kind: "shamela", resultCount: 3 });
  });

  it("dedups a repeat of the same query+kind within the 30s window (touches it instead)", () => {
    addSearch(db, { kind: "shamela", query: "نية", resultCount: 3 });
    addSearch(db, { kind: "shamela", query: "نية", resultCount: 9 });
    const rows = listSearches(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].resultCount).toBe(9);
  });

  it("keeps a different kind as its own row", () => {
    addSearch(db, { kind: "shamela", query: "نية" });
    addSearch(db, { kind: "corpus", query: "نية" });
    expect(listSearches(db)).toHaveLength(2);
  });

  it("ignores a blank query", () => {
    addSearch(db, { kind: "shamela", query: "   " });
    expect(listSearches(db)).toHaveLength(0);
  });

  it("remove + clear", () => {
    addSearch(db, { kind: "shamela", query: "a" });
    addSearch(db, { kind: "shamela", query: "b" });
    const [first] = listSearches(db);
    removeSearch(db, first.id);
    expect(listSearches(db)).toHaveLength(1);
    clearSearches(db);
    expect(listSearches(db)).toHaveLength(0);
  });
});
