import { generateJSON } from "@tiptap/core";
import { supabase } from "@/integrations/supabase/client";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";
import { documentService } from "./documentService";

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/**
 * Convert a stored HTML section into Tiptap JSON.
 *
 * Uses Tiptap's own `generateJSON` against the editor's real schema
 * (`buildEditorExtensions`) rather than walking the DOM by hand. A hand-rolled
 * walker that reads `textContent` flattens everything it doesn't recognise:
 * a citation blockquote collapses into one paragraph with the quote and the
 * reference glued together, list items merge, and bold/italic marks vanish.
 * Those are exactly the structures scholarly sections are made of.
 */
export function htmlToTiptapJSON(html: string): Record<string, unknown> {
  if (!html || !html.trim()) return { ...EMPTY_DOC };

  try {
    const json = generateJSON(html, buildEditorExtensions()) as Record<string, unknown>;
    const content = json?.content;
    if (Array.isArray(content) && content.length > 0) return json;
    return { ...EMPTY_DOC };
  } catch (err) {
    // Malformed HTML shouldn't abort a bulk migration, but it must be visible:
    // the section keeps its original `content` column either way.
    console.error("[bookSectionMigration] HTML → JSON conversion failed:", err);
    return { ...EMPTY_DOC };
  }
}

/**
 * Migration helper to additive-link `book_projects` to `projects`
 * and migrate `book_sections` HTML content to `documents.content_json`.
 */
export async function migrateBookSectionsToDocuments(bookProjectId: string): Promise<{ migratedCount: number }> {
  // 1. Fetch book project
  const { data: rawBookProj, error: bpErr } = await supabase
    .from("book_projects")
    .select("*")
    .eq("id", bookProjectId)
    .single();

  if (bpErr || !rawBookProj) {
    throw new Error(`Book project ${bookProjectId} not found`);
  }

  const bookProj = rawBookProj as any;

  // 2. Ensure parent project exists in `projects` table
  let parentProjectId = bookProj.project_id;
  if (!parentProjectId) {
    const newProj = await documentService.createProject(bookProj.title, "book", {
      book_project_id: bookProj.id,
      genre: bookProj.genre,
    });
    parentProjectId = newProj.id;

    // Link back to book_projects
    await (supabase.from("book_projects") as any)
      .update({ project_id: parentProjectId })
      .eq("id", bookProjectId);
  }

  // 3. Fetch book chapters & sections needing document migration.
  //    NOTE: the FK column on book_chapters is `project_id` (it points at
  //    book_projects.id), not `book_id`. Errors are rethrown rather than
  //    swallowed — a mistyped column here previously returned
  //    `{ migratedCount: 0 }` and looked like a successful no-op migration.
  const { data: chapters, error: chapErr } = await (supabase.from("book_chapters") as any)
    .select("id")
    .eq("project_id", bookProjectId);

  if (chapErr) throw chapErr;

  const chapterIds = chapters?.map((c: any) => c.id) || [];
  if (chapterIds.length === 0) return { migratedCount: 0 };

  const { data: sections, error: secErr } = await supabase
    .from("book_sections")
    .select("*")
    .in("chapter_id", chapterIds);

  if (secErr) throw secErr;
  if (!sections || sections.length === 0) return { migratedCount: 0 };

  let migratedCount = 0;

  for (const rawSec of sections) {
    const sec = rawSec as any;
    if (sec.document_id) continue; // Already migrated

    const contentJson = htmlToTiptapJSON(sec.content || "");

    // Create document in canonical `documents` table
    const doc = await documentService.createDocument(
      parentProjectId,
      sec.title || "Untitled Section",
      contentJson
    );

    // Link document_id in book_sections (non-destructive, leaves content untouched).
    // This link is what makes the migration re-runnable, so a failure here must
    // surface — silently skipping it would re-create the document next run.
    const { error: linkErr } = await (supabase.from("book_sections") as any)
      .update({ document_id: doc.id })
      .eq("id", sec.id);

    if (linkErr) throw linkErr;

    migratedCount++;
  }

  return { migratedCount };
}

/**
 * Migration helper to additive-link `translation_projects` to canonical `projects` table.
 */
export async function backfillTranslationProjects(): Promise<{ linkedCount: number }> {
  const { data: rawTransProjects, error } = await (supabase.from("translation_projects") as any)
    .select("*")
    .is("project_id", null);

  if (error || !rawTransProjects) return { linkedCount: 0 };

  let linkedCount = 0;
  for (const rawTp of rawTransProjects) {
    const tp = rawTp as any;
    const newProj = await documentService.createProject(tp.title || "Translation Project", "translation", {
      translation_project_id: tp.id,
      source_language: tp.source_lang || tp.source_language,
      target_language: tp.target_lang || tp.target_language,
    });

    await (supabase.from("translation_projects") as any)
      .update({ project_id: newProj.id })
      .eq("id", tp.id);

    linkedCount++;
  }

  return { linkedCount };
}
