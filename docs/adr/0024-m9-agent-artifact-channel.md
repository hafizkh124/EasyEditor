# ADR 0024 — The Agent Artifact Channel; "Skills" Are Playbooks Plus Guidance

**Status:** Accepted · **Date:** 2026-09-03 · **Milestone:** SPEC-M9

## Context

M8's `AgentProgress` is a flat `{ step, label, kind, detail }` — enough for a
chat-inline step line, nothing more. M9's use cases produce structured work the
scholar needs to *see as it forms*: a chapter draft, an apparatus-criticus
table, a running citation list, the proposed plan. The M9 proposal also asked
for a "skills framework" (`shared/agent/skills/` — takhrij / manuscript /
typesetting / fahariss).

## Decision — the artifact channel

`AgentProgress` becomes a discriminated shape carrying an optional
`AgentArtifactEvent` under `kind: 'artifact'`, on the **same `AGENT_PROGRESS`
IPC channel** (no new allowlist entry). Event ops: `open`, `delta`
(append/replace, html or text), `table`, `citations`, `close` (final/aborted,
with the target chapter).

- `dispatch.ts` gets an injected `emitArtifact`; `run.ts` forwards artifact
  events to `onProgress`. Tools with structured output emit
  (`draft_section` today; `compare_manuscript_variants`,
  `build_scholarly_indexes`, `transcribe_media`, `query_tafseer`,
  `search_hadith` as they land). `runPlaybook` emits `open`/`close` around a
  run and its plan.
- Renderer: `src/components/workspace/agentArtifactState.ts` (a pure reducer,
  unit-tested) + `AgentArtifactPanel.tsx` (renders per type). Phase 0 shows it
  inline in the Agent panel; Phase 1b adds the resizable chat/artifact split.

## Decision — no `shared/agent/skills/`

A "skills" directory would duplicate `shared/playbooks/`. The four proposed
skills are met by:

- richer playbooks (`bind` / `optional` steps, ADR-0020),
- the fixed `draft_section` templates (ADR-0021),
- `قواعد.md` (standing project constraints),
- the new per-playbook `guidance` string, appended to the system prompt **only**
  for that playbook's run.

"Skill" = a playbook plus its guidance. No new layer.

## Consequences

- `AgentProgress` fields become optional; `stopReason` gains `needs-input`
  (M9 defect #4) for the clarify gate (ADR-0027 F6) and a rejected plan
  (ADR-0026). Both cross the preload boundary — `electron/preload.ts` updated.
- Plan mode's plan is itself an artifact (`artifactType: 'plan'`).
