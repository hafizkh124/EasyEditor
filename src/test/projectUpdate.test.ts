// @vitest-environment node
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabaseSchema } from '../../electron/db/schema.js';
import { createProject, getProject, updateProject } from '../../electron/db/workspaceStore/documents.js';

/** A folder's name and `meta` (where its pinned sources live) can change on the desktop too. */
describe('updateProject (desktop store)', () => {
  it('renames and replaces meta, leaving what was not given', () => {
    const db = new Database(':memory:');
    initializeDatabaseSchema(db);
    const p = createProject(db, 'فتاویٰ', 'general', { a: 1 });
    updateProject(db, p.id, { meta: { pinnedSources: [{ ref: 'shamela:1', label: 'بدائع' }] } });
    expect(getProject(db, p.id)).toMatchObject({ title: 'فتاویٰ', meta: { pinnedSources: [{ ref: 'shamela:1', label: 'بدائع' }] } });
    updateProject(db, p.id, { title: 'فتاویٰ زکوٰۃ' });
    expect(getProject(db, p.id)?.title).toBe('فتاویٰ زکوٰۃ');
    expect(getProject(db, p.id)?.meta).toEqual({ pinnedSources: [{ ref: 'shamela:1', label: 'بدائع' }] });
    expect(() => updateProject(db, 'missing', { title: 'x' })).toThrow();
  });
});
