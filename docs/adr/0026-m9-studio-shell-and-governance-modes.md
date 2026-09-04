# ADR 0026 — Studio Shell and Governance Modes (Ask / Plan / Auto)

**Status:** Accepted · **Date:** 2026-09-03 · **Milestone:** SPEC-M9

> **Phase 0 (2026-09-03):** the mode rework shipped — cross-cutting through
> `loop.ts` / `run.ts` / `preload.ts`, so it landed early while the surface area
> was small.
>
> **Phase 1b (2026-09-05):** the shell shipped — window-chrome fix, `+`
> attachment/connectors hub, per-project connector toggles, collapsible
> "Ran N steps" progress cards, and the context stats pill. **The dual-view
> toggle and the centre project badge were deliberately deferred** — see below.

## Context

M8's Agent panel had a two-way **Ask / Do** toggle. The M9 proposal (informed by
Claude's Chat/Cowork surface) asked for a fuller shell and a richer permission
model — a per-run plan-approval mode and a per-write approval mode.

## Decision — modes

`mode` widens from `'ask' | 'do'` to **`'ask' | 'plan' | 'auto'`** (an old
`'do'` maps to `'auto'` at the IPC boundary).

- **Ask** — unchanged: `effect: 'read'` tools only, no checkpoint.
- **Plan** — the loop / executor produces its step list, emits it as a `plan`
  artifact, and **stops before the first write** until the scholar approves it
  (`agent.approvePlan` IPC → `electron/agent/planApproval.ts`, request/resolve
  like `generalSearch.ts`). One approval per run, not per write.
- **Auto** — M8's "Do": every step runs; writes are tracked changes; "Undo this
  task" reverts the whole checkpoint.

`toolsForMode` maps `plan`/`auto` to the write-capable set; the Plan gate lives
in the loop (`waitForApproval`), not in tool filtering.

## Decision — no per-write "Manual" mode

A mode that pauses before *every* write would need pause/resume state inside
both the dispatcher and the playbook executor and roughly doubles the mode test
matrix. Plan mode already gives per-run approval of the full step list, which
covers the cautious-scholar case. Revisit only if Plan proves too coarse in
practice.

## Decision — shell (Phase 1b, shipped)

- **Window chrome:** the hardcoded `titleBarOverlay.color` (`#1e1e2e`,
  Catppuccin dark — the "black box in the corner", wrong in light mode) is gone.
  `electron/windowChrome.ts` computes the overlay from the app palette
  (`#f5f5f5`/`#171717` light, inverse dark) and pushes it on
  `nativeTheme.on('updated')` and on a `system:set-theme` message the renderer
  sends with next-themes' `resolvedTheme` (which can override the OS).
- **Command center:** a `+` hub next to the input — add files (the Phase 3
  import path), change folder, open the `/` playbook picker, and **connector
  toggles**. Connectors (`shared/agent/connectors.ts`) group the tools that
  reach one source (Shamela, tafsir, hadith, web); a switch off is stored in
  `.easyeditor/project.json` `connectors`, hides those tools from the model
  (`run.ts` filters `toolsFor`'s output), and skips any playbook step that needs
  one (`runPlaybook` `disabledTools`).
- **Collapsible progress cards:** a finished multi-step run collapses to
  `Ran N steps ›`, expandable; while running the live lines stay (trust). Pure
  renderer grouping over `ProgressLine[]`; the full transcript is still the
  Trust tab's.
- **Context stats pill:** `📁 <project> · <n> ch · <n> source off · <Word
  status>` under the input.

### Deferred: dual-view toggle + centre project badge

Both live in `WorkspaceTopBar` / `WorkspaceLayout` / `WorkbenchPanel` — shared
workspace chrome that every tab (not just Agent) renders, tightly coupled to the
capability registry and the resizable-panel layout. They are pure presentation
(no capability), and Phase 1b was explicitly the slice that "can slip without
blocking anything". Restructuring shared chrome for polish, against a large test
surface, is not worth it mid-milestone; revisit as its own change if the
single-column workbench proves cramped once the artifact panel is in heavy use.

## Consequences

- `agentPanel.test.tsx` updated (Do → Auto, + a Plan-mode assertion).
- i18n keys `agent.mode_plan` / `agent.mode_auto` / `agent.hint_plan` /
  `agent.plan_*` / `agent.needs_input*` added to en/ur/ar.
