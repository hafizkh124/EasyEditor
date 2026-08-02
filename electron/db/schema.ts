import { randomUUID } from 'node:crypto';
import { EMBED_MODEL, EMBED_DIMS } from '../../shared/ai/embedConstants.js';
import { normalizeArabicForSearch } from '../../shared/text/arabicSearch.js';
import type { SqliteDatabase } from './open.js';

/**
 * SPEC-M5 FR-4.2: column names here are copied VERBATIM from the Postgres
 * migrations (`supabase/migrations/20260728000000_workspace_core.sql`,
 * `..._m4_personal_corpus.sql`, `..._m4_knowledge_graph.sql`,
 * `..._m4_recipes.sql`, `..._m3_tasks.sql`), minus RLS/auth/triggers, which
 * are meaningless for a single-user local file. This is deliberate: the two
 * WorkspaceBackend implementations must return identical-shaped objects, so
 * the ~40 UI files above the adapter never need to know which one is live.
 *
 * A few local-only additions exist where the app genuinely needs them and
 * Postgres does not (e.g. `library_chunks.page_number`/`part_number` for
 * fast Shamela lookups, `library_chunk_embeddings` as the sqlite-vec
 * fallback table) — these are called out inline.
 */
export function initializeDatabaseSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS corpus_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'general',
      status TEXT NOT NULL DEFAULT 'active',
      genre TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled Document',
      doc_type TEXT NOT NULL DEFAULT 'prose',
      content_json TEXT NOT NULL DEFAULT '{}',
      plain_text TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content_json TEXT NOT NULL DEFAULT '{}',
      plain_text TEXT NOT NULL DEFAULT '',
      label TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      kind TEXT NOT NULL DEFAULT 'note',
      title TEXT NOT NULL,
      source_ref TEXT NOT NULL DEFAULT '{}',
      storage_path TEXT,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_chunks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      library_item_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ur',
      char_start INTEGER,
      char_end INTEGER,
      -- Local-only: not in Postgres (which encodes book/volume/page inside
      -- the meta column), kept here for fast Shamela page lookups without a JSON scan.
      page_number INTEGER,
      part_number INTEGER,
      meta TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE (library_item_id, chunk_index),
      FOREIGN KEY (library_item_id) REFERENCES library_items(id) ON DELETE CASCADE
    );

    -- Local-only fallback table backing the brute-force cosine search in
    -- electron/db/vectorSearch.ts, used only when the sqlite-vec extension
    -- fails to load (SPEC-M5 FR-4.3). Kept in sync with library_chunk_vec by
    -- upsertChunkVector.
    CREATE TABLE IF NOT EXISTS library_chunk_embeddings (
      chunk_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES library_chunks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      anchor TEXT NOT NULL DEFAULT '{}',
      note TEXT NOT NULL,
      color TEXT DEFAULT 'yellow',
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      document_id TEXT,
      task_slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input TEXT NOT NULL DEFAULT '{}',
      output TEXT NOT NULL DEFAULT '{}',
      sources TEXT NOT NULL DEFAULT '[]',
      confidence REAL,
      model TEXT,
      tokens_spent INTEGER DEFAULT 0,
      progress TEXT NOT NULL DEFAULT '{"total":0,"done":0,"failed":0,"skipped":0}',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (user_id, canonical_name)
    );

    CREATE TABLE IF NOT EXISTS entity_relations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_entity_id TEXT NOT NULL,
      target_entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      evidence_quote TEXT,
      document_id TEXT,
      library_item_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
      FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      steps TEXT NOT NULL DEFAULT '[]',
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    -- Postgres table name is ai_tasks (SPEC-M3 §m3_tasks migration), not
    -- custom_tasks — the frontend type is CustomTaskRow, but the store name
    -- follows Postgres verbatim per FR-4.2.
    CREATE TABLE IF NOT EXISTS ai_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      base_task_slug TEXT,
      scope TEXT NOT NULL DEFAULT 'either',
      apply_mode TEXT NOT NULL DEFAULT 'inline',
      output_format TEXT NOT NULL DEFAULT 'text',
      chunkable INTEGER NOT NULL DEFAULT 1,
      produces_sources INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, slug)
    );

    -- SPEC-M6: Track when library items were last accessed (for Home screen recent books)
    CREATE TABLE IF NOT EXISTS document_access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE
    );
  `);

  // Create indexes separately (IF NOT INDEX is not standard SQLite)
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_access_log_item ON document_access_log(item_id);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_access_log_time ON document_access_log(accessed_at DESC);`);
  } catch {
    // Indexes may already exist
  }

  // SPEC-M6: Add updated_at column to library_items if missing (ALTER TABLE is idempotent with try-catch)
  try {
    db.exec(`ALTER TABLE library_items ADD COLUMN updated_at TEXT DEFAULT NULL;`);
  } catch {
    // Column already exists
  }

  // Initialize vec0 virtual table for sqlite-vec
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS library_chunk_vec USING vec0(
        chunk_id text primary key,
        embedding float[${EMBED_DIMS}]
      );
    `);
  } catch (err) {
    console.warn('sqlite-vec table creation warning (falling back if virtual table unavailable):', err);
  }

  // SPEC-M6 Phase 5: FTS5 keyword search over imported chunks. The index is
  // built over a NORMALIZED copy of each chunk (harakat stripped, alef/ta
  // marbuta/alef maqsura folded) so Arabic keyword search is insensitive to
  // diacritics and script variants. `trigram` tokenizer gives substring
  // matching, which Arabic needs (الحسين must match والحسين). Rows are
  // maintained by the app layer (ingest.storeChunk / library.deleteItem),
  // not triggers, because normalization requires JS.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS library_chunks_fts USING fts5(
      search_text,
      library_item_id UNINDEXED,
      chunk_index UNINDEXED,
      page_number UNINDEXED,
      part_number UNINDEXED,
      tokenize = 'trigram'
    );
  `);

  // Ensure corpus_meta values exist
  const getMeta = db.prepare('SELECT value FROM corpus_meta WHERE key = ?');
  const setMeta = db.prepare('INSERT OR REPLACE INTO corpus_meta (key, value) VALUES (?, ?)');

  if (!getMeta.get('embed_model')) {
    setMeta.run('embed_model', EMBED_MODEL);
  }
  if (!getMeta.get('embed_dims')) {
    setMeta.run('embed_dims', String(EMBED_DIMS));
  }
  if (!getMeta.get('local_user_id')) {
    // FR-1.2ب: a real UUID, not a human-readable placeholder — this value is
    // stamped onto every row's user_id and must behave like the UUIDs
    // Postgres uses on the cloud side.
    setMeta.run('local_user_id', randomUUID());
  }
  if (!getMeta.get('schema_version')) {
    setMeta.run('schema_version', '1');
  }

  // SPEC-M6 Phase 5: one-time backfill of the FTS index for chunks imported
  // before the virtual table existed. Guarded by a corpus_meta flag so it
  // runs once, not on every open.
  if (!getMeta.get('fts_backfilled')) {
    const chunkCount = db.prepare('SELECT COUNT(*) AS c FROM library_chunks').get() as { c: number };
    if (chunkCount.c > 0) {
      try {
        const rows = db.prepare(
          'SELECT content, library_item_id, chunk_index, page_number, part_number FROM library_chunks',
        ).all() as Array<{
          content: string;
          library_item_id: string;
          chunk_index: number;
          page_number: number | null;
          part_number: number | null;
        }>;
        const insert = db.prepare(
          'INSERT INTO library_chunks_fts (search_text, library_item_id, chunk_index, page_number, part_number) VALUES (?, ?, ?, ?, ?)',
        );
        db.transaction(() => {
          for (const r of rows) {
            insert.run(
              normalizeArabicForSearch(r.content), r.library_item_id, r.chunk_index,
              r.page_number, r.part_number,
            );
          }
        })();
      } catch (err) {
        // FTS5 unavailable (rare): log and continue without keyword search.
        console.warn('[schema] FTS5 backfill failed (keyword search disabled):', err);
      }
    }
    setMeta.run('fts_backfilled', '1');
  }
}
