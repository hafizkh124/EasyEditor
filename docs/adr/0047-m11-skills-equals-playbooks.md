# ADR 0047 — "Skills" = Playbooks, Not a New Layer

**Status:** Accepted · **Date:** 2026-09-10 · **Milestone:** M11 (Phase 3) · **Confirms:** [ADR-0024](./0024-m9-agent-artifact-channel.md)

## Context

M11 Phase 3 introduces a `SkillsPanel` in Settings and exposes playbooks as "skills" in the UI. ADR-0024 already established that a skill is a playbook plus guidance — no separate system. The question is whether "skills" should be a new runtime layer (a fifth name alongside Playbooks/Recipes/Tasks/Prompts) or simply the UI label for the existing playbook registry.

## Decision

**Playbooks get full UI visibility as "Skills".** The 20 playbooks in `shared/playbooks/registry.ts` are surfaced through a `SkillsPanel` in Settings, each with a title, `/trigger`, guidance text, step count, and an on/off toggle. The toggle follows the same two-tier pattern as connectors (ADR-0037): global state in `userData/connectors.json` under a `skills` key, project-level override in `.easyeditor/project.json`, merged via `mergeConnectorState`-style logic.

No new runtime layer is created. `run.ts`'s `selectPlaybook()` skips disabled playbooks. The `+` hub in the composer shows playbooks under a "Skills" section header with the `/` trigger prefix.

## Consequences

- New: `SkillsPanel.tsx`, `shared/playbooks/store.ts` (two-tier enable/disable), i18n keys for `skills.*`.
- No change to `shared/playbooks/registry.ts` or `executor.ts`.
- The `Add ▾` hub in the composer gains a "Skills" row alongside Sources, Connectors, and Prompts.
- Tests: `composerHub.test.tsx` covers the five hub rows; `skillsPanel.test.tsx` covers toggle persistence.
