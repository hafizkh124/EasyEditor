# ADR 0034 — Unified research surface (supersedes 0002, amends 0026)

**Status:** Accepted · **Date:** 2026-09-07 · **Milestone:** M10 §1 · **Supersedes:** [ADR-0002](./0002-three-mode-research.md) · **Amends:** [ADR-0026](./0026-m9-studio-shell-and-governance-modes.md)

## Context

By M9 there were two chat surfaces doing overlapping work:

- **Research tab** (`ResearchPanel` → `useResearchChat` → `islamic-search` /
  `research-query`) — ask a question, get an answer with citations.
- **Agent tab** (`AgentPanel` → `useAgentRun` → `shared/agent/loop.ts`) — the
  same kind of question, plus a tool loop that can read/write the open
  project. Its `ask` mode (`toolScoping.ts`, `effect: 'write'` tools fully
  blocked) is a strictly *richer* version of what Research does: same
  retrieval, plus optional project context, minus nothing.

`AgentPanel.tsx` had reimplemented Research's streaming logic by hand
(`handleResearch`, ~30 lines duplicating `useResearchChat.runQuery`) rather
than reusing it — the two surfaces had drifted rather than shared code.

On top of that, ADR-0002's three research modes had already been reduced to
two (Islamic / General) in an earlier round (P5, per memory
`easyeditor-p5-research-modes-drafted`), leaving a single Islamic-vs-General
toggle (`ResearchModeSwitcher.tsx`) whose entire job was a decision the
backend could already make itself:

- `islamic-search/index.ts` already had a **STRICT SOURCE MODE** (grounded,
  citations required) and a **REFERENCED MODE** (general-knowledge fallback,
  `📌 معلومات عامہ` disclosure label) — both branches of `buildSystemPrompt`
  existed before this ADR. The only missing piece was picking one
  automatically instead of asking the user to pre-declare it.

ADR-0002 itself had flagged the direction of travel in its own "Negative"
section: *"Three modes is more screen real estate than a toggle, especially
on mobile."* Three modes → two modes (P5) → **zero modes** is the logical end
of that same line, and it is also what clears the mobile composer of a control
that carries no information the system doesn't already have.

## Decision

### 1. Auto-derived strictness — no user-facing mode switch

`islamic-search` derives strict-vs-referenced from the retrieval result
itself, not a client flag:

```ts
export function deriveStrictMode(explicitStrictMode: unknown, resultCount: number): boolean {
  return typeof explicitStrictMode === "boolean" ? explicitStrictMode : resultCount > 0;
}
```

- Corpus hits (`resultCount > 0`) → strict, grounded, citations required
  (existing STRICT SOURCE MODE prompt).
- Zero hits → referenced/general-knowledge mode with the existing
  `📌 معلومات عامہ` disclosure label (existing REFERENCED MODE prompt).
- An explicit `true`/`false` from an older client is still honored — this is
  additive, not a breaking wire change.

**Quota follows the same auto-derivation.** A query that resolves to
referenced mode was billed as `islamic` (40 tokens) but did the work of a
`research` query (30 tokens); the handler now fires a fire-and-forget refund
for the 10-token difference whenever the *effective* mode (not the requested
one) came out referenced:

```ts
export function autoReferencedRefundAmount(explicitStrictMode: unknown, effectiveStrictMode: boolean): number | null {
  if (typeof explicitStrictMode === "boolean" || effectiveStrictMode) return null;
  return TOKEN_COSTS.islamic - TOKEN_COSTS.research;
}
```

`ResearchModeSwitcher.tsx` is deleted. `useResearchChat`'s `runQuery` collapses
from three branches to two: assist-modes (spelling/citation, unchanged, still
billed against the `research` quota) and everything else through
`streamIslamicQuery` — no client-chosen mode branch remains.
`streamIslamicQuery`'s `strictMode` parameter becomes optional; omitting it
(not passing `false`) is what requests server auto-derivation.

### 2. One tab, one composer, one timeline — not a merge of implementations

The Research and Agent tabs become one `research` tab, decided by
**capability + open project folder**, not by a user-visible mode toggle:

- No project folder open, or `wb.agent` unavailable (web today) → exactly the
  existing plain research chat, unchanged behavior.
- Project folder open and `wb.agent` available (desktop) → the agent branch:
  `AgentComposer` (Ask/Plan/Auto, mentions, playbooks, dictation, drag-drop)
  wrapping `ChatDisplay`'s new `agent_run` timeline item.

This is **composition, not a rewrite**: `AgentPanel`'s ~840 lines of
state/effects/handlers moved verbatim into a `useAgentRun()` hook; its render
JSX (progress lines, plan-approval card, collapsible "Ran N steps", OCR
consent, artifacts) moved verbatim into a new branch of `ChatDisplay`'s
existing `ListItem` union, which already owned markdown rendering, citations,
refine/copy/regenerate, and virtualization. `AgentPanel.tsx` itself is kept
(not deleted) purely as the 16-test regression anchor from M9 — it is
unreachable from any route now that `WorkbenchPanel`'s `agent` tab is gone.

Ask mode in the merged surface *is* Research — same retrieval, same auto-
derived strictness, just with the option of project context. This directly
answers the user's original complaint: *"ایجنٹ کے اندر آسک موڈ سرچ والا کام
ہی کرتا ہے"* ("Agent's Ask mode already does what Search does").

### 3. One composer hub, not five scattered controls

Before this ADR the plain-chat composer had five separate controls
(`ModeChips`, `ResearchModeSwitcher`, `SourcePicker`, a "14 علمی پرامپٹس"
button, a send-hint line), and the agent composer had its own separate `+`
hub. Consolidated into the single `+` hub pattern the agent composer already
used: one button, one popover (sheet on mobile) with three rows — Sources
(`SourcePicker`, untouched), Assist modes (`ModeChips`, untouched), and a
Scholarly-prompts trigger. `SourcePicker.tsx` and `ModeChips.tsx` were not
modified — this is pure composition around them, plus a small dot badge on
the hub button when sources are narrowed or an assist mode is active, so the
collapsed state doesn't hide that something is set.

## Rationale

- **The backend already had both branches; only the client-side gate was
  redundant.** Removing `ResearchModeSwitcher` deletes a decision from the
  user without deleting any capability — STRICT and REFERENCED modes both
  still exist and are both still reachable, just chosen by evidence
  (retrieval hits) instead of by asking first.
- **Composition over rewrite** kept the risk bounded: `useAgentRun`'s handlers
  and `ChatDisplay`'s agent-run rendering are the *same* code that already had
  M9's test coverage, relocated rather than reinvented. `agentPanel.test.tsx`'s
  16 cases kept passing unmodified (beyond a `MemoryRouter` wrapper needed
  once `AgentPanel` started composing `ChatDisplay`, which calls
  `useNavigate()` unconditionally).
- **The composer hub reuses a pattern already proven correct** (the agent
  composer's own `+` hub) rather than inventing a second UI language for the
  same job — one fewer thing for a scholar to learn switching between what
  is now, correctly, one surface.
- **Quota refund, not a new quota bucket.** Auto-derivation could have meant a
  third pricing tier; instead the existing `research`/`islamic` costs stay,
  and a fire-and-forget refund closes the gap only when the auto-derived
  outcome actually undershoots what was charged.

## Consequences

**Positive**
- One research surface everywhere it can exist; no mode to pick, confirm, or
  lose a draft over when switching.
- Mobile composer goes from five stacked controls to one `+` button — the
  single biggest composer-density win of M10 Phase 1 (see M10 plan §Phase 3
  rollout, which builds on this).
- Web today (no `wb.agent`) is untouched byte-for-byte in behavior — the
  branch is capability-gated, so this ADR ships with zero web-visible change
  until Phase 2 lands the web agent dispatcher.

**Negative**
- `askFastPath()` (a single-model-call shortcut for a plain Ask with no
  mentions/write intent, avoiding the loop's 2–3-call overhead) is **not**
  part of this ADR — it is deferred, tracked in the M10 plan under Phase 1.2
  follow-ups. It does not regress anything today because the agent branch
  already went through the full loop before this merge; it is a pure
  future optimization, not a correctness gap.
- Migrating `agentPanel.test.tsx`'s 16 cases onto `ResearchPanel` directly
  (rather than keeping the now-unreachable `AgentPanel` as the anchor) is
  deferred — it needs a much larger mock surface (auth, subscription,
  token-balance) that the isolated `AgentPanel` test didn't require.

## Amends ADR-0002 and ADR-0026

- **Supersedes ADR-0002 in full.** The three-mode (Islamic/Custom
  Sources/General) — already reduced to two in P5 — is now zero modes;
  `ResearchModeSwitcher.tsx` is deleted. ADR-0013's opt-in source picker
  (which had already superseded part of ADR-0002) is unaffected and remains
  the mechanism for narrowing sources.
- **Amends ADR-0026's "Deferred: dual-view toggle" section.** That deferral
  was about `WorkspaceTopBar`/`WorkspaceLayout` chrome-level presentation and
  remains deferred as stated. This ADR is a different axis — which *tab*
  surfaces the agent loop at all — and resolves it by merging the tabs
  rather than adding a toggle between two permanently-separate views.

## Follow-ups

- `askFastPath()` latency optimization (Ask + no mentions + no write intent →
  skip tool selection) — M10 Phase 1.2 follow-up, not yet done.
- Migrate `agentPanel.test.tsx` onto `ResearchPanel` directly, retiring the
  now-unreachable standalone `AgentPanel` render path as a test target.
- `WorkbenchPanel`'s tab count reduction (7→4 web, 6→3 desktop) continues in
  M10 Phase 3.6, building on the tab merge this ADR completes.
