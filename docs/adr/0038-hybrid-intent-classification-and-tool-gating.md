# ADR 0038 — Hybrid intent classification and tool gating

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub · **Extends:** [ADR-0027](./0027-m9-efficiency-and-intent-precision.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md)

## Context

ADR-0027 F2 narrows the tool list by keyword domain, and F1's fast path routes a
plain single-chapter edit straight to `run_task`. But with the Connectors Hub
landing 6–8 source connectors, two gaps show:

1. **Plain editing still spins the loop.** "Rewrite this paragraph" with the text
   inline (no `@chapter`, no task-slug keyword) misses the fast path and runs the
   full agentic loop with every search tool available — the model often does a
   pointless `search_corpus` first.
2. **A domain-adjacent ask fans out.** "What is this hadith's isnād?" matches the
   hadith keyword rule but still leaves `query_tafseer`, `search_repositories`
   etc. on the table; the model sometimes calls the wrong one on a surface match.

The user's ask: a two-level "intent filter" — zero connector calls for ordinary
editing, and exactly one connector for a request that clearly belongs to it.

## Decision

### Level 1 — a pure, instant heuristic (`shared/agent/intent.ts`)

`classifyIntent(instruction, { connectorsOn })` returns one of:

- **`direct`** — an `EDIT_VERB` match (rewrite / spelling / harakat / translate /
  summarise — a superset of `fastPath`'s `TASK_HINTS`) AND no `NEEDS_SOURCE`
  phrase (cite / حوالہ / تخریج / grade / fatwa …). The loop can answer in one
  turn with no retrieval.
- **`gated`** — `matchDomains(ask)` (lifted out of `toolScoping.toolsFor` and
  exported) points at exactly ONE connector, and that connector is enabled. Only
  that connector's tools are offered.
- **`open`** — anything else. `ambiguous: true` when there is zero or multi
  connector signal; that is the ONLY case Level 2 may run.

It reuses `fastPath`'s verb intent and `toolScoping`'s domain rules rather than a
third keyword table. `DomainRule` gained an optional `connector?` tag; the
tafsir, hadith and repositories rules carry one, the multi-source rules (fatwa,
review) deliberately do not.

### Level 2 — one cached LLM call (`electron/agent/intentClassifier.ts`)

Only when Level 1 is `ambiguous` and the run is not a playbook. Mirrors
`modelRouter.checkClaim` exactly: the LOOP provider's fast `textModel`,
`temperature: 0`, JSON response, and the OpenAI-compat branch for non-Gemini
providers. `coerceIntent` is the trust boundary (mirrors
`queryPlanner.coercePlan`) — an unknown route string, a `gated` verdict naming no
known connector, or a non-object response all fall back to the heuristic flagged
`degraded`. It **never throws**. A 24 h cache in `userData/intent-cache.json`
(pruned to ~500 entries) keyed by `sha256(instruction + sorted connector ids)`;
the cache is an optimisation, never a dependency.

Rejected: "always spend the LLM call". It adds latency and a provider dependency
to the hot path of every run, for no gain on the ~80 % of asks the heuristic
already classifies confidently. The team has fought latency regressions before
(P4, P6).

### Gating is subtractive, and runs last (`toolScoping.gateConnectors`)

`ScopeContext.gateConnectors?: string[]` — when set (an array, **even empty**),
every source-connector tool is dropped unless its connector id is listed. `[]`
therefore means "no connector tools at all" (a plain edit). Applied strictly
**after** playbook/domain narrowing, so a domain keyword match can never re-add a
connector the classifier ruled out; the existing citation-closure +
FLOOR-guarantee + `CLARIFY_TOOL` tail still runs last and unchanged. Non-connector
tools (`read_document`, `insert_footnote`, `run_task`, `search_corpus` — which is
FLOOR) are never touched.

`run.ts` composes it: resolve `connectors` (merged Hub state) → `classifyIntent`
→ maybe `classifyIntentLLM` → `gateConnectors` from the route (`gated` → its
connectors, `direct` → `[]`, `open` → undefined) → `buildSystemPrompt({ …,
toolGating: negativeConstraintBlock(route) })`. A `direct` route in **Ask mode**
additionally short-circuits to `runAgentLoop(tools: [], maxSteps: 2)` — a plain
question answered from the text in front of the model, zero retrieval. Playbook
runs are never gated (already scoped to their steps).

### The system-prompt block

`negativeConstraintBlock(route)` produces a `── TOOL SCOPE (this request) ──`
block appended after the mode line (both `buildSystemPrompt` and
`buildWebSystemPrompt`). Fixed sentences: `direct` forbids every research
connector; `gated` names the allowed connector's tools and forbids the sibling
connectors by name; `open` adds nothing.

### Provenance is DERIVED, not a new event

The plan considered a `provenance` `AgentArtifactEvent` op. Instead
`connectorsUsed(toolCalls)` (pure, in `connectors.ts`) reads the finished
transcript — a connector tool with a non-error result that returned rows — and
`<ProvenanceChips>` renders a quiet `[ماخذ: باحوث]` pill under the answer in
`ChatDisplay`. Display-only, zero dispatch/reducer/types churn, and it can never
disagree with what the run actually did.

### Web parity

`useWebAgentEngine` runs Level 1 only (no LLM, no per-project connector switches
— every connector counts as on) and threads `gateConnectors` + the prompt block
the same way. The live-eval harness (`agentEval.live.test.ts`) mirrors `run.ts`'s
Level-1 wiring so its scenarios exercise the real gated tool sets.

## Consequences

**Positive**
- A plain edit in Ask mode makes zero tool calls; a hadith/tafsir/repositories
  ask is scoped to that one connector, prompt and tool-list both.
- No new latency on the ~80 % of runs the heuristic settles; the one optional
  call is cached for 24 h and degrades silently.
- Provenance chips give the scholar a quiet "this came from Bahouth" without any
  new event plumbing.

**Negative**
- The `EDIT_VERB` / `NEEDS_SOURCE` regexes are a maintenance surface — a missed
  verb just means "no shortcut", but a false `direct` on something that needed a
  source would be worse; `NEEDS_SOURCE` is deliberately broad to guard that edge.
- A `direct`-in-Ask short-circuit answers from the instruction text alone; if the
  scholar meant "rewrite chapter 3" without naming it, the model has to ask.
- Level 2 adds a provider dependency to the ambiguous path — mitigated by the
  cache, the ~1-call budget, and the never-throw fallback.

## Follow-ups

- Per-connector `DOMAIN_RULES` + `connector` tags land with each new connector's
  phase (Dorar, Ilm, lexicon, Ganjoor, prosody).
- Web Level-2 (an `agent-model`-style edge call) if web usage shows the heuristic
  is too coarse there.
