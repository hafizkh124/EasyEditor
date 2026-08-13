import { supabase } from "@/integrations/supabase/client";
import { logger } from "@/lib/logger";
import {
  migrateBookSectionsToDocuments,
  migrateTranslationChunksToDocument,
} from "./bookSectionMigration";

const log = logger.child("legacyMigration");

/**
 * Moves Book Studio and Translation Projects data into the canonical
 * projects/documents model.
 *
 * Both legacy surfaces predate the three-pillar workspace, which supports
 * `kind: "book"` and `kind: "translation"` natively. The migration helpers to
 * move their content had been written but were never called from anywhere, so
 * the old tables kept the only copy while their pages sat unreachable — not
 * linked from any menu, only findable by typing the URL.
 *
 * Everything here is additive: the legacy rows are read and stamped with the id
 * of what they became, never deleted. Running it twice is a no-op, because both
 * helpers skip rows that already carry that stamp.
 *
 * Web only. These tables exist solely in the hosted database — a desktop build
 * has nothing to migrate, which is why both pages are `desktop: never` in the
 * capability registry.
 */

export interface LegacyMigrationSummary {
  bookProjects: number;
  bookSections: number;
  translationProjects: number;
  translationChunks: number;
  failures: { kind: "book" | "translation"; id: string; message: string }[];
}

/** How much unmigrated legacy data this user still has. Cheap enough to poll on mount. */
export async function countPendingLegacyData(): Promise<{ books: number; translations: number }> {
  const [books, translations] = await Promise.all([
    (supabase.from("book_projects") as any).select("id", { count: "exact", head: true }).is("project_id", null),
    (supabase.from("translation_projects") as any).select("id", { count: "exact", head: true }).is("document_id", null),
  ]);

  return {
    books: books?.count ?? 0,
    translations: translations?.count ?? 0,
  };
}

/**
 * Runs both migrations for the signed-in user.
 *
 * One project's failure must not abort the rest — a single malformed row would
 * otherwise strand everything behind it — so failures are collected and
 * returned rather than thrown.
 */
export async function migrateLegacyWorkspaces(): Promise<LegacyMigrationSummary> {
  const summary: LegacyMigrationSummary = {
    bookProjects: 0, bookSections: 0,
    translationProjects: 0, translationChunks: 0,
    failures: [],
  };

  const { data: bookProjects } = await (supabase.from("book_projects") as any).select("id");
  for (const bp of bookProjects ?? []) {
    try {
      const { migratedCount } = await migrateBookSectionsToDocuments(bp.id);
      if (migratedCount > 0) {
        summary.bookProjects += 1;
        summary.bookSections += migratedCount;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("book project migration failed", { id: bp.id, message });
      summary.failures.push({ kind: "book", id: bp.id, message });
    }
  }

  const { data: transProjects } = await (supabase.from("translation_projects") as any)
    .select("id")
    .is("document_id", null);
  for (const tp of transProjects ?? []) {
    try {
      const { migratedChunks } = await migrateTranslationChunksToDocument(tp.id);
      if (migratedChunks > 0) {
        summary.translationProjects += 1;
        summary.translationChunks += migratedChunks;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("translation project migration failed", { id: tp.id, message });
      summary.failures.push({ kind: "translation", id: tp.id, message });
    }
  }

  log.info("legacy migration finished", { ...summary, failures: summary.failures.length });
  return summary;
}
