# ADR 0018 — The Project Folder (docx/rtf) Is the Source of Truth, Not an Internal Document Model

**Status:** Accepted · **Date:** 2026-08-29 · **Milestone:** SPEC-M8

## Context

Two designs were considered for where a SPEC-M8 project's real content
lives.

**Design A (rejected):** an internal representation — Markdown chapter
files plus a JSON manifest — as the source of truth, with `.docx`/`.pdf`
generated on export. This was the first draft of this spec. It was rejected
once the actual requirement was restated plainly: the researcher's
supervisor reviews, comments on, and tracks changes in the **Word file
itself**. Regenerating that file from an internal Markdown representation on
every agent run would discard exactly that review history — tracked
changes, comments, and any manual formatting the supervisor or researcher
did directly in Word — every single time. A round-trip through an internal
model is lossy in a way that matters most to the people whose approval the
document exists for.

**Design B (accepted):** the `.docx`/`.rtf` file the researcher already has
is the one and only source of truth. The agent opens it, performs surgical
edits (insert a tracked-change paragraph, add a footnote entry, adjust page
setup), and saves the same file — never regenerating it wholesale. Anything
the agent doesn't understand in the file (an embedded object, a field code,
a comment thread) is preserved byte-for-byte rather than dropped.

A second, related question was how a researcher works across devices or
with collaborators without EasyEditor building its own sync infrastructure.
Desktop clients for Google Drive, OneDrive, and Dropbox already present a
synced folder as an ordinary local folder — so an *ordinary folder* of
`.docx` files gets multi-device and sharing support at zero engineering
cost, simply by living inside one of those synced folders.

## Decision

1. **The project folder is a plain folder of real files** — `.docx`
   chapters, a `sources/` folder, a `templates/` folder, an `export/`
   folder — not a database and not an internal document format. `.docx` and
   `.pptx` are edited *in place* via the Word/PowerPoint adapters (surgical
   OOXML edits, not regeneration); `.rtf` (the InPage bridge) and `.pdf` are
   one-way exports only, produced from the `.docx`, never edited back.
2. **`src/core/backend/fileBackend.ts`** implements the existing
   `WorkspaceBackend` interface (`src/core/backend/types.ts`) as a third
   backend alongside `cloudBackend` (Supabase) and the existing SQLite
   `localBackend` — `cloudBackend` is untouched, so the web app is
   unaffected by any of this.
3. **The vector index never lives inside the project folder**, even though
   the folder itself may sit inside a synced drive. It lives in
   `app.getPath('userData')`, keyed per project, and is rebuildable from the
   files at any time. SQLite depends on OS-level file locking to stay
   consistent, and that locking is documented as unreliable inside
   cloud-sync folders (Dropbox, OneDrive, Google Drive) and network
   filesystems — an index placed there will eventually corrupt. Files are
   the truth; the index is a disposable derivative of them.
4. **Real-time (Google-Docs-style) simultaneous co-editing is explicitly out
   of scope.** Drive/OneDrive/Dropbox sync at the file level, not by
   merging concurrent edits — two people editing the same chapter file at
   the same moment produces a "conflicted copy," not a merge. Splitting a
   thesis into one file per chapter keeps this collision rare in practice,
   and `FS_WATCH` (in `electron/ipc/fsHandlers.ts`) detects an
   externally-changed file so the UI can surface a conflicted-copy warning
   — but the app must say plainly that this is not simultaneous co-authoring,
   not imply it is.

## Consequences

- Any future feature that wants to "regenerate" a chapter file from
  structured data (an outline, a template) must do so by editing the
  existing file's OOXML surgically, never by producing a fresh file that
  discards what a human already put into the old one.
- A project's true state can always be inspected and edited with tools
  EasyEditor didn't write — Word itself, a text editor on the manifest,
  File Explorer — because there is no proprietary storage layer standing
  between the researcher and their files.
- If real-time co-editing is ever wanted, it is a separate, larger feature
  built on the existing Supabase/`cloudBackend` path (which already has a
  server and can support CRDT-style merging), not an extension of the
  folder-sync model described here.
