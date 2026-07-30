import type { SqliteDatabase } from '../open.js';

/**
 * FR-1.2ب: local mode has no auth, so identity is a stable UUID minted on
 * first run and kept in corpus_meta (see schema.ts's use of randomUUID()).
 */
export function getCurrentUserId(db: SqliteDatabase): string {
  const row = db.prepare("SELECT value FROM corpus_meta WHERE key = 'local_user_id'").get() as { value: string } | undefined;
  if (!row) throw new Error('local_user_id is missing from corpus_meta — the database was not initialized correctly.');
  return row.value;
}

export function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`;
}
