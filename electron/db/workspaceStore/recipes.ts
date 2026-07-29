import type { SqliteDatabase } from '../open.js';
import { BUILTIN_RECIPES } from '../../../src/lib/recipes/builtinRecipes.js';
import type { Recipe } from '../../../src/lib/recipes/builtinRecipes.js';

/**
 * Mirrors cloudRecipes.listRecipes: falls back to BUILTIN_RECIPES whenever
 * the table is missing or empty. Unlike Postgres — which pre-seeds the three
 * built-ins via migration INSERT — a fresh local SQLite file never has rows
 * here at all, since recipe authoring is out of scope for local mode (SPEC-M5
 * §2 Non-Goals). The fallback is therefore the ONLY path locally, and it is
 * byte-identical to what the seeded Postgres rows would produce.
 */
export function listRecipes(db: SqliteDatabase): Recipe[] {
  const rows = db.prepare('SELECT * FROM recipes ORDER BY is_builtin DESC').all() as any[];
  if (!rows || rows.length === 0) return BUILTIN_RECIPES;

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id || undefined,
    title: r.title,
    description: r.description || undefined,
    steps: JSON.parse(r.steps || '[]'),
    is_builtin: !!r.is_builtin,
    created_at: r.created_at,
  }));
}
