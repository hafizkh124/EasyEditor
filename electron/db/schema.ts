import { EMBED_MODEL, EMBED_DIMS } from '../../shared/ai/embedConstants.js';
import type { SqliteDatabase } from './open.js';

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
      kind TEXT NOT NULL DEFAULT 'standard',
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled Document',
      content_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content_json TEXT NOT NULL DEFAULT '{}',
      label TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'upload',
      file_path TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_chunks (
      id TEXT PRIMARY KEY,
      library_item_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      page_number INTEGER,
      part_number INTEGER,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (library_item_id) REFERENCES library_items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      note TEXT,
      color TEXT DEFAULT 'yellow',
      range_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_id TEXT,
      task_slug TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'editor',
      status TEXT NOT NULL DEFAULT 'pending',
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT,
      canonical_name TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_mentions (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      document_id TEXT,
      chunk_id TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      context_snippet TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
    );
  `);

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
    // Generate stable UUID for local user identity
    const localUserId = 'local-user-' + Math.random().toString(36).substring(2) + '-' + Date.now().toString(36);
    setMeta.run('local_user_id', localUserId);
  }
  if (!getMeta.get('schema_version')) {
    setMeta.run('schema_version', '1');
  }
}
