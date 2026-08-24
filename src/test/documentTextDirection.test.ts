// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../../electron/db/schema.js';
import { createProject, createDocument, updateDocument, getDocument } from '../../electron/db/workspaceStore/documents.js';

/**
 * Persisted writing direction, desktop side.
 *
 * The editor used to re-derive direction from a document's text on every open
 * and store nothing, so a document could open left-to-right despite being
 * almost entirely Urdu — and once it did, nothing re-decided. `text_direction`
 * records an actual decision; NULL keeps the old detect-from-content behaviour.
 *
 * The upgrade case matters most: this column ships to installs that already
 * hold the user's documents, so adding it must not disturb a single existing
 * row.
 */

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  initializeDatabaseSchema(db);
  return db;
}

function newDoc(db: Database.Database, content = {}) {
  const project = createProject(db, 'P');
  return createDocument(db, project.id, 'Doc', content);
}

describe('document text_direction (desktop store)', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('starts undecided so the editor still detects from content', () => {
    expect(newDoc(db).text_direction).toBeNull();
  });

  it('persists an explicit direction and reads it back', () => {
    const doc = newDoc(db);
    const updated = updateDocument(db, doc.id, { text_direction: 'rtl' });
    expect(updated.text_direction).toBe('rtl');
    expect(getDocument(db, doc.id)?.text_direction).toBe('rtl');
  });

  it('leaves a stored direction alone when an unrelated field is updated', () => {
    const doc = newDoc(db);
    updateDocument(db, doc.id, { text_direction: 'rtl' });
    // A title edit must not silently revert the author's direction choice.
    const updated = updateDocument(db, doc.id, { title: 'New title' });
    expect(updated.text_direction).toBe('rtl');
    expect(getDocument(db, doc.id)?.text_direction).toBe('rtl');
  });

  it('can be moved back to undecided with an explicit null', () => {
    const doc = newDoc(db);
    updateDocument(db, doc.id, { text_direction: 'rtl' });
    // null is a value here, not "absent" — it must not be treated as no-op.
    const updated = updateDocument(db, doc.id, { text_direction: null });
    expect(updated.text_direction).toBeNull();
    expect(getDocument(db, doc.id)?.text_direction).toBeNull();
  });

  it('adds the column to a database created before it existed, preserving rows', () => {
    // A pre-upgrade install: the documents table without text_direction.
    const legacy = new Database(':memory:');
    legacy.exec(`
      CREATE TABLE documents (
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
        updated_at TEXT NOT NULL
      );
    `);
    legacy.prepare(`
      INSERT INTO documents (id, project_id, user_id, title, content_json, plain_text, word_count, created_at, updated_at)
      VALUES ('d1', 'p1', 'u1', 'پرانی دستاویز', '{}', 'متن', 1, '2026-01-01', '2026-01-01')
    `).run();

    initializeDatabaseSchema(legacy);

    const cols = (legacy.prepare('PRAGMA table_info(documents)').all() as Array<{ name: string }>)
      .map((c) => c.name);
    expect(cols).toContain('text_direction');

    // The existing row survives untouched and reads as undecided, so upgrading
    // cannot flip the direction of work the user already has.
    const row = legacy.prepare('SELECT * FROM documents WHERE id = ?').get('d1') as Record<string, unknown>;
    expect(row.title).toBe('پرانی دستاویز');
    expect(row.text_direction ?? null).toBeNull();

    legacy.close();
  });
});
