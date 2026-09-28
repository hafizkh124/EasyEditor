# ADR 0059 — Search the scholar's computer; read any document; add a folder to the library; hybrid corpus search

**Status:** Accepted · **Date:** 2026-09-29 · **Milestone:** M13 Scholar Desktop Agent · **Extends:** [ADR-0023](./0023-m9-ocr-consent-gated-cloud-bridge.md), [ADR-0027](./0027-m9-efficiency-and-intent-precision.md), [ADR-0056](./0056-m13-outside-project-file-edits.md)

## Context

The blueprint's first front: "find my files anywhere on the computer, and
search inside my books by meaning". Before M13 the agent could search only
the imported library (FTS) and the open project's chapters. A sqlite-vec
index was already written by every ingest (`electron/db/vectorSearch.ts`)
but **nothing ever queried it**.

## Decision

1. **`search_my_computer` (read) uses the Windows Search index** — the one
   Explorer uses: free, already built, ~100–500 ms, and it does both file-name
   and full-text (`CONTAINS`) queries, Urdu included (verified live). It is
   queried over OLE DB from a one-shot PowerShell process (`-EncodedCommand`,
   request on stdin). The SQL is assembled in TypeScript from sanitised parts
   only (allow-listed extensions, a validated folder scope, a term with every
   quote/wildcard/bracket removed); the script executes the string it is given
   and never evaluates model text. **Windows Search SQL rejects `IN (…)`**
   (0x80040E14, found live) — extensions are an `OR` list. Spelling variants
   (with/without ٰ and harakat, ی/ي/ى, ک/ك, ہ/ه, ۃ/ة) are OR'd for names.
   EasyEditor's own `.easyeditor/` backup/history copies are filtered out.
   When the index is unavailable, a bounded directory walk (Desktop,
   Documents, Downloads, OneDrive; 5 s / 200 hits; dot-folders, AppData and
   node_modules skipped) answers **file-name** queries. Results show as a
   table artifact. *Everything (es.exe) was considered and not used* — an
   extra install for no gain over the built-in index.
2. **`read_external_document` (read)** returns ~6000-char windows of any
   document's text (`start` to page). `.docx` is read straight from the zip
   (`word/document.xml` via Node zlib, only `<w:t>` runs; the text-box
   `mc:Fallback` duplicate and drawing offsets are dropped — both seen on a
   real file); `.doc/.rtf/.odt` via Word; `.pdf` via `pdfjs-dist` (marked
   external in the main bundle — it loads its worker by path). Urdu PDFs that
   extract in visual order are detected (final-only letters ے ں ة ى starting
   >3% of words) and the result says so and points to `ocr_document`. App
   data folders and non-document types are refused. The model sees the text —
   the scholar asked for it.
3. **`add_folder_to_library` (write)** replaces the planned Settings
   "library folders" screen: the scholar says "add D:\Books to my library",
   approves one card per call (file count, size, "text goes to Gemini for
   embeddings, your files are not changed"), and each document is extracted
   locally, stored as a library item with pre-extracted text, and embedded by
   the existing ingest pipeline. ≤25 files per call; unchanged files
   (path + size + mtime) are skipped, changed ones replaced, garbled or
   near-empty ones skipped with a reason.
4. **`search_corpus` is now hybrid**: FTS hits reciprocal-rank-fused (k=60)
   with sqlite-vec hits (`WorkspaceDbService.searchChunksSemantic`, cosine
   similarity ≥ 0.5 so a small corpus does not return unrelated nearest
   neighbours). The query embedding has a 4 s budget; no key / no vectors /
   timeout ⇒ keyword hits only, silently.

## Consequences

- File names and document text found this way are sent to the agent's model
  provider as tool results — the same as any other retrieval, on the
  scholar's explicit ask.
- Content search covers only folders Windows has indexed (by default the
  user profile); `add_folder_to_library` is the path for other drives.
- Not done: a Settings screen listing library folders, background
  re-indexing on change.
