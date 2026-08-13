import { generateJSON } from "@tiptap/core";
import { supabase } from "@/integrations/supabase/client";
import { buildEditorExtensions } from "@/components/editor/editorExtensions";
import { documentService } from "./documentService";
import { logger } from "@/lib/logger";

const log = logger.child("bookSectionMigration");

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
    log.error("HTML → JSON conversion failed", { err });
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
 *
 * This links the project SHELL only. `migrateTranslationChunksToDocument`
 * carries the actual content.
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Render a project's chunks as the HTML body of a single document.
 *
 * Each chunk becomes the source as a blockquote followed by its translation as
 * body text, which is how the pair reads once it is out of the two-column
 * workspace. Chunks with neither side filled in are dropped — an untouched
 * paragraph placeholder is not content worth migrating.
 *
 * Exported for testing: this is the part with the interesting edge cases.
 */
export function translationChunksToHtml(
  chunks: { chunk_index: number; source_text: string | null; translated_text: string | null; notes?: string | null }[],
): string {
  return [...chunks]
    .sort((a, b) => a.chunk_index - b.chunk_index)
    .flatMap((chunk) => {
      const source = (chunk.source_text ?? "").trim();
      const translated = (chunk.translated_text ?? "").trim();
      const notes = (chunk.notes ?? "").trim();
      if (!source && !translated) return [];

      const parts: string[] = [];
      if (source) parts.push(`<blockquote><p>${escapeHtml(source)}</p></blockquote>`);
      if (translated) parts.push(`<p>${escapeHtml(translated)}</p>`);
      // Notes were a working aid; keep them, but visibly subordinate.
      if (notes) parts.push(`<p><em>${escapeHtml(notes)}</em></p>`);
      return parts;
    })
    .join("\n");
}

/**
 * Migrate a legacy translation project's chunks into one canonical document.
 *
 * `backfillTranslationProjects` only ever linked the project row, so the chunk
 * content — the actual translation work — had no path into projects/documents
 * and would have been stranded when /translate-workspace was retired.
 *
 * Non-destructive and re-runnable, like the book migration: `translation_chunks`
 * is only read, and `translation_projects.document_id` records the result so a
 * second run skips the project rather than creating a duplicate document.
 */
export async function migrateTranslationChunksToDocument(
  translationProjectId: string,
): Promise<{ migratedChunks: number; documentId: string | null }> {
  const { data: rawTp, error: tpErr } = await (supabase.from("translation_projects") as any)
    .select("*")
    .eq("id", translationProjectId)
    .single();

  if (tpErr || !rawTp) throw new Error(`Translation project ${translationProjectId} not found`);
  const tp = rawTp as any;

  // Already migrated — nothing to do, and nothing to duplicate.
  if (tp.document_id) return { migratedChunks: 0, documentId: tp.document_id };

  // The shell must exist first; reuse the backfill's own linking rules.
  let parentProjectId = tp.project_id;
  if (!parentProjectId) {
    const newProj = await documentService.createProject(tp.title || "Translation Project", "translation", {
      translation_project_id: tp.id,
      source_language: tp.source_lang || tp.source_language,
      target_language: tp.target_lang || tp.target_language,
    });
    parentProjectId = newProj.id;
    await (supabase.from("translation_projects") as any)
      .update({ project_id: parentProjectId })
      .eq("id", tp.id);
  }

  const { data: chunks, error: chunkErr } = await (supabase.from("translation_chunks") as any)
    .select("chunk_index, source_text, translated_text, notes")
    .eq("project_id", translationProjectId);

  if (chunkErr) throw chunkErr;
  if (!chunks || chunks.length === 0) return { migratedChunks: 0, documentId: null };

  const html = translationChunksToHtml(chunks);
  if (!html) return { migratedChunks: 0, documentId: null };

  const doc = await documentService.createDocument(
    parentProjectId,
    tp.title || "Translation Project",
    htmlToTiptapJSON(html),
  );

  // The link is what makes this re-runnable, so a failure here must surface:
  // silently skipping it would create a second document on the next run.
  const { error: linkErr } = await (supabase.from("translation_projects") as any)
    .update({ document_id: doc.id })
    .eq("id", tp.id);

  if (linkErr) throw linkErr;

  return { migratedChunks: chunks.length, documentId: doc.id };
}
