# ADR 0010 — Workspace Is the Single Home

**Status:** Accepted · **Date:** 2026-08-13 → 2026-08-14 · **Milestone:** UX-v1 P3

## Context

`SPEC-M2.md` introduced the three-pillar `/workspace` shell as a *parallel*
destination behind `VITE_WORKSPACE_SHELL`, redirecting from the legacy
standalone pages (`/editor`, `/research`, …) only when the flag was on — so
the weekly merge into `main` could never break the old flow (FR-1.3).

Two more standalone destinations predated the three-pillar shell entirely and
were never migrated onto it at all: `/book-workspace` (Book Studio) and
`/translate-workspace` (TranslationWorkspace's own page shell), both because
`ProjectKind` didn't yet have `"book"`/`"translation"` support when they were
built.

By 2026-08-13 the workspace shell natively supported both `kind: "book"` and
`kind: "translation"` projects (rendered inside `CanvasPanel`), and an audit
found `VITE_WORKSPACE_SHELL` had never actually shipped set to `false` — the
"M1 fallback" path was dead code. Neither `/book-workspace` nor
`/translate-workspace` was linked from any menu; both were reachable only by
typing the URL. Having six-plus live entry points into overlapping
functionality (`/editor`, `/research`, `/library`, `/translate`, `/extract`,
`/book-workspace`, `/translate-workspace`) meant every future workspace
feature had to be reasoned about across all of them, and a bookmarked old URL
led to an increasingly stale second implementation.

## Decision

`/workspace` (and `/workspace/:documentId`) is the single entry point for
all document/research/translation/extraction work, on both web and desktop.
Every other route that used to render a full standalone page for this now
does exactly one of four things:

1. **Redirects to `/workspace` with a query param** that opens the matching
   pillar/tab — `/research` → `?panel=research`, `/translate` →
   `?panel=translate`, `/extract` → `?panel=extract`.
2. **Redirects to `/workspace/:documentId`, preserving `location.state`** —
   `/editor` and `/editor/:documentId`, via `RedirectToWorkspace.tsx`. This
   is a component rather than a bare `<Navigate>` in the route table
   specifically because a declared `<Navigate>` cannot see the incoming
   location and would silently drop the handoff state that
   Research/OCR/Transcribe/Extract pass through it.
3. **Is deleted outright** — `/book-workspace`, `BookWorkspace.tsx`, and its
   four components (`BookOutlineSidebar`, `BookEditorView`,
   `BookExportModal`, `KhittatBahthModal`). Confirmed dead: no other
   reference anywhere in the codebase.
4. **Loses the route but keeps the component** — `/translate-workspace`.
   The route and its capability-registry entry are gone, but
   `TranslationWorkspace.tsx` itself lives on: `CanvasPanel` renders it
   *embedded* whenever a `kind: "translation"` project is open. That is
   exactly what its `embedded` prop was already for.

The `VITE_WORKSPACE_SHELL` flag and its M1-fallback branches were removed
rather than left in place, since they had never gated a real deployed
difference.

## Consequences

- One place (`CanvasPanel.tsx` + `WorkspaceContext`) now owns "what does the
  user see," instead of that decision being split across seven independent
  route handlers.
- Retiring a *page* does not retire its *data*. Rows already sitting in
  `book_projects`/`book_sections`/`translation_projects`/`translation_chunks`
  are not deleted — `legacyMigration.ts`'s `migrateLegacyWorkspaces()` is the
  one remaining path from those tables into `documents`, surfaced through
  `LegacyImportBanner` (re-gated to `!isDesktop()`, since the desktop
  capability-registry entries that used to gate it were among those
  removed).
- Old bookmarks/links to `/editor`, `/research`, `/library`, `/translate`,
  `/extract` keep working (redirected). `/book-workspace` and
  `/translate-workspace` return `NotFound` instead — deliberate, since
  neither was ever linked and Book Studio genuinely has nowhere left to
  redirect to.
- This is the precondition the P3.4 fix (`TranslationWorkspace` scoped to
  the actually-open document, 2026-08-15) landed cleanly against:
  `CanvasPanel` was already the sole renderer of the embedded
  `TranslationWorkspace`, so wiring it to `doc.id`/`doc.project_id` touched
  exactly one decision point instead of several route handlers.
- New workspace capabilities should assume `/workspace` is the only door.
  Don't add a new standalone page for something that already has, or could
  have, a `ProjectKind`/panel slot — extend the shell instead.
