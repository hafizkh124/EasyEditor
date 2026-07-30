/**
 * Workspace Document Service — now a facade over the backend adapter.
 *
 * The implementation moved to src/core/backend/cloud/documents.ts in M5.0 so a
 * second implementation (SQLite, M5.3) can take its place. Every call site
 * keeps working unchanged: the method names and signatures are identical.
 */
import { backendFacade } from "@/core/backend";
import type { DocumentBackend } from "@/core/backend";

export const documentService: DocumentBackend = backendFacade("documents");

/**
 * Re-exported from shared/ — both backends must derive `plain_text` and
 * `word_count` the same way, or the same document would report two different
 * lengths depending on where it was last saved.
 */
export { extractPlainTextFromJSON, countWords } from "~shared/text/plainText";
