# ADR 0026 — Studio Shell and Governance Modes (Ask / Plan / Auto)

**Status:** Accepted · **Date:** 2026-09-03 · **Milestone:** SPEC-M9

> **Phase 0 (2026-09-03):** the mode rework shipped — it is cross-cutting
> through `loop.ts` / `run.ts` / `preload.ts`, so it lands early while the
> surface area is small. The rest of the shell (window chrome, dual-view,
> `+` hub, progress cards, context pill) is Phase 1b.

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

## Decision — shell (Phase 1b)

- **Window chrome:** the hardcoded `titleBarOverlay.color` (`electron/main.ts`,
  the black-corner-box bug) is replaced by a dynamic
  `mainWindow.setTitleBarOverlay(...)` on theme change.
- **Dual-view toggle:** Chat & Research / Document · Canvas — a relabel of the
  existing `WorkbenchPanel` tabs plus a two-state group header, not a new layout
  engine.
- **Command center:** a `+` hub (add files/folder, `/` playbooks, connector
  toggles held in `.easyeditor/project.json`), collapsible "Ran N steps ›"
  progress cards (renderer grouping over `ProgressLine[]`), a context stats pill.

## Consequences

- `agentPanel.test.tsx` updated (Do → Auto, + a Plan-mode assertion).
- i18n keys `agent.mode_plan` / `agent.mode_auto` / `agent.hint_plan` /
  `agent.plan_*` / `agent.needs_input*` added to en/ur/ar.
