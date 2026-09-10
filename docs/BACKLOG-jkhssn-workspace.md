# Backlog — JKHSSN + Workspace milestone (post-v2.0.9)

The 6-phase milestone (جوامع الكلم hybrid engine + workspace IDE overhaul) shipped
in **v2.0.9** (`main` @ `25d1f14`). Plan: `C:\Users\hafiz\.claude\plans\purrfect-tickling-minsky.md`.
ADR-0045. These items were consciously deferred during the milestone — each is
scoped and non-blocking. Grouped by area, roughly in priority order.

---

## 1. Batch mode — the run UI (Phase 4.6)

The engine is done: `batch_runs` table + `workspaceStore/batchRuns.ts`,
`svc.latestUnfinishedBatchRun()`, `runBatch()` loop with a live-growing
document/table artifact, and `AgentProgress { kind: 'batch-item', step, total }`
events on the existing channel. What's missing is the render.

- [ ] **Sticky determinate progress row** in `ChatDisplay` for `kind: 'batch-item'`
      — one row ("۷ / ۱۸ — فتح الباري", elapsed, a Cancel), not N appended step
      lines. Plan §4.6.
- [ ] **"بیچ دوبارہ شروع کریں (i/N)"** button next to "Undo this task" in the
      agent result card. Reads `svc.latestUnfinishedBatchRun()`; calls
      `agent.run(instruction, mode, root, { …scope, batch: { granularity, resumeFrom } })`
      (the `resumeFrom` field is already validated in `agentHandlers.ts` and
      threaded through `runBatch`).
- [ ] **Scale/cost line** emitted once before the loop ("۱۸ کتب پر بیچ چل رہا ہے —
      تخمیناً ۴ منٹ"), estimated from item count × the session's median single-run
      duration.
- [ ] Tests: `scopeReviewDialog.test.tsx` (resolve + prune + intersect +
      persisted selection), `catalogue.test.ts` (`listBooks`/`countBooks`
      intersections). `agentBatch.test.ts` covers the loop already.

## 2. `matn-diff` artifact — agent emission (Phase 5.5 / 5.6)

`MatnDiff.tsx` + `wordDiff.ts` render fine from a `{ variants: [{label, text}] }`
payload, but nothing emits one. `axisMatnCompare` returns ids only; the matn text
lives in Supabase (`islamicurdubooks-hadith`, `urdu-hadith`).

- [ ] In `electron/agent/dispatch.ts` `jkhssn_takhrij` / `jkhssn_judgments`: when
      `axisMatnCompare` returns a group, resolve each member's matn via the
      `session.researchSearch` bridge (mirrors how `adapters/jkhssn.ts` resolves
      narrator names) and `emitArtifact({ op: 'open', artifactType: 'matn-diff' })`
      + `{ op: 'data', payload: { variants } }`.
- [ ] `shared/agent/jkhssnQuery.ts` `buildJkhssnMatnQuery` already exists — wire it.
- Known Hybrid limitation (ADR-0045): free-text → `hadith_main_id` is weak, so
  this is best-effort and only fires when a prior `jkhssn_takhrij` gave a group id.

## 3. UI-triggered JKHSSN axes (Phase 2.3 / 5.5)

- [ ] `src/hooks/useJkhssnAxis.ts` — calls `window.electronAPI.jkhssn.axis*` then
      completes names/matn from the renderer's signed-in Supabase client
      (`resolveNames.ts` is the narrator half; a matn resolver is still needed).
- [ ] Wire it to: clicking a narrator name in the Shamela reader, and a History
      → Searches re-run of a `kind: 'jkhssn'` row.
- [ ] `recordSearch({ kind: 'jkhssn' })` at those call sites.

## 4. JKHSSN browse tab inside مکتبہ (Phase 3.1)

The plan's naming table has a **جوامع الكلم** tab in `LibraryPanel`, gated on
`useJkhssnAvailability`. It was cut because there is no browse surface yet — the
engine is query-only (axes take a `hadith_main_id`).

- [ ] A minimal browse view: thematic tree (`axisThematic` drill-down) + a
      book/number → `jkhssn_takhrij` lookup box. Or defer until a real need.

## 5. Mobile (< 768px) — bottom bar (Phase 3.0)

Desktop-first shipped; mobile still uses the old hand-rolled `drawerStyle`.

- [ ] Replace with the `Sheet` primitive: Canvas is the page, the two rails
      collapse to a bottom bar with 4 targets (مکتبہ · تاریخ · مسودہ · معاون),
      each opening a full-height sheet; the artifact stage becomes a sheet opened
      from the run's artifact chip. `min-h-touch` on every target. Retire
      `WorkspaceLayout`'s `drawerStyle` math. Plan §3.0 "Mobile".

## 6. Verification still outstanding

- [ ] **RTL screenshot pass** of `/workspace` in `ur` / `ar` / `en` — both rails,
      side panel, status bar, artifact stage, composer chips, every popover.
      Blocked in the dev sandbox (route needs auth, redirects to login). Add an
      RTL shot to the visual-regression setup or a PR-checklist item.
      `react-resizable-panels` v2 RTL was verified by reading its source (it
      negates its own horizontal drag delta for `dir="rtl"`); the layout-order
      fix landed in `4d702ba`.
- [ ] **`npm run build:electron`** + packaged-installer smoke on real
      Windows + Word (the `check-jkhssn-index` guard warns-not-fails without the
      259 MB seed; confirm the seed path in a real build).
- [ ] Consistent `focus-visible` ring across **all** Phase 3–4 new surfaces
      (Phase 5 got the sweep; the rail / composer / dialog buttons still rely on
      the browser default).

## 7. Shamela Lucene bookId filter (Phase 4.5)

- [ ] `search_shamela` scope is currently a post-filter over a widened `limit`
      ("best effort") because `ShamelaHelper.java`'s `search` has no bookId
      parameter. Add one to the helper, or accept the post-filter and document
      the recall trade-off in the run notes.

---

## Done since the milestone merged

- ✅ `search_history` Supabase table + RLS + index (Lovable `4106494`, 2026-09-10)
  — the signed-in search-history path is live; no longer degrades to the local
  SQLite mirror for logged-in users.
