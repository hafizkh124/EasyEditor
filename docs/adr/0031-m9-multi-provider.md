# ADR 0031 — Multi-Provider Model Routing

**Status:** Accepted · **Date:** 2026-09-06 · **Milestone:** SPEC-M9 (Phase C)

## Context

M8 hard-wired the agent to Gemini 2.5 Flash. The blueprint asks for Groq and
OpenRouter (and, through OpenRouter, DeepSeek/Qwen) so a scholar can pick a
faster or cheaper model, or one with better Arabic. The risk (blueprint §4):
the whole agent rests on **tool calling** — the free loop and every playbook
`bind` step — and the wire format is Gemini-specific.

Phase B built the eval that makes this safe: a candidate provider runs the same
9 scenarios and must clear `baseline.json`.

## Decisions

**A static registry, `shared/agent/providers.ts`.** One `ProviderSpec` per
provider: `kind` ('gemini' | 'openai-compat'), `baseUrl`, `host`, key pattern,
`getKeyUrl`, and three model roles — `toolModel` (loop + bind calls),
`textModel` (draft_section / run_task / indexes), `reasoningModel` (offered
only as a future critic, **never** a tool driver, per §4). Model ids are
overridable per provider with an env var so a deprecated id is a config change,
not a release.

**One OpenAI-compatible path** covers Groq and OpenRouter. The wire-format
mapping that differs from Gemini lives in `electron/agent/openAiCompatTools.ts`
and is pinned by `openAiCompatTools.test.ts`:

| Gemini | OpenAI-compatible |
| --- | --- |
| tool result: role `user` + `functionResponse` | role `tool` + `tool_call_id` |
| schema types UPPERCASE | JSON Schema lowercase |
| `functionCallingConfig` mode `ANY` | `tool_choice: {type:'function',…}` |
| header `x-goog-api-key` | `Authorization: Bearer` |

AgentMessages carry no tool-call ids; they are synthesised and paired
positionally (the loop strictly alternates assistant-toolCall → tool-result).
Reasoning `<think>…</think>` blocks are stripped from text output.

**The `ModelFn` seam, extended.** `runAgentLoop` already took an injected
`ModelFn`. `runPlaybook` now takes `{ generate, generateBound }` instead of
importing `geminiTools` directly. `dispatch.ts` routes text generation through
`generateAgentText`. `electron/agent/modelRouter.ts` resolves the active
provider into all three, plus `checkClaim` (`insert_footnote`'s second tier) —
which follows the LOOP provider (whatever drives the citations verifies them,
and it is always eval-verified) but uses that provider's fast `textModel` and
JSON mode (`responseMimeType` for Gemini, `response_format: json_object` for
openai-compat). Still non-fatal: any failure degrades to "no opinion".
`claimCheck.ts` is now a one-line re-export.

**Per-provider BYOK keys.** `electron/ai/keyStore.ts` generalised to
`byok_<id>.enc` (the Gemini file name is unchanged); a headless / eval run
falls back to `<ID>_API_KEY`. The M8 `getDecryptedGeminiKey` etc. are kept as
aliases.

**Two roles, one gate.** `electron/ai/providerConfig.ts` persists
`{ active, text, verified }`:
- `active` drives the **agentic loop + playbook bind calls** (tool calling).
  `setActiveProviderId` refuses a non-Gemini provider not in `verified` — the
  eval measures exactly this. Marked verified from the Settings panel (which
  shows the `EVAL_PROVIDER=<id> AGENT_EVAL_LIVE=1 …` command) after the scholar
  sees it clear the eval; `AGENT_VERIFIED_PROVIDERS` force-verifies for CI.
- `text` drives **plain text generation** (`draft_section`, `run_task`, index
  extraction) via `generateAgentText`. It defaults to `active` but can differ —
  e.g. Gemini for the loop, Groq for drafting. `setTextProviderId` is **not**
  eval-gated: text gen runs a fixed instruction and its output lands as a
  tracked change the scholar reviews, so the risk the eval measures (tool
  choice, grounding) does not apply. It just needs a key.

**A separate outbound allowlist.** `electron/lib/agentModelAllowlist.ts` (NOT
`urlAllowlist.ts`, which gates `shell.openExternal`) — the agent's model
clients may only `fetch` a registered provider host, over https.

**Privacy is per-provider, not inherited.** `ProviderSpec.privacyNote` (set for
OpenRouter — third-party routing, models outside the EU/US) renders in the
panel before the key field. Selecting Gemini was one trust decision; each new
provider is another.

## First run (Groq, 2026-09-06)

- **Stale model id.** `llama-3.3-70b-versatile` was gone from Groq. Switched
  the defaults to `openai/gpt-oss-120b` (tools) / `-20b` (text) / `qwen/qwen3.8-27b`
  (reasoning) — all overridable via `GROQ_TOOL_MODEL` etc.
- **`fetch failed` with no cause.** The client now retries a transport failure
  and surfaces `err.cause`.
- **Free-tier rate limits.** Groq's free tier is tokens-per-minute limited (a
  ~60 s window). `openai/gpt-oss-120b` requests are large enough that a
  back-to-back run 429s before completing. Fixed on two fronts: the client
  retries a 429 four times honouring `retry-after` (up to 45 s), and the eval
  pauses 25 s between scenarios so the window resets. With
  `openai/gpt-oss-20b` (now the Groq default) **Groq clears the loop eval on
  the free tier** — 78 % pass, 100 % citation-resolve, 0 grounding violations,
  3.7 mean steps (2026-09-06). A paid tier can set
  `GROQ_TOOL_MODEL=openai/gpt-oss-120b` for stronger tool selection.

**The reasoning-model critic (§4).** A reasoning model (DeepSeek-R1, Qwen 3)
forces tool calls poorly but critiques rigorously, so it is offered ONLY as a
critic — never a loop driver. A third role, `critic`, defaults to the `text`
provider and uses that provider's `reasoningModel` when it has one. Not
eval-gated (the output is advisory prose, never an edit). `electron/agent/
critic.ts` `runCritique({kind, subject, …})` calls the client with NO tools,
strips `<think>`, and degrades to a short note on any failure. Surfaced two
ways: the `critique` tool (reads a chapter / section, returns verdict + numbered
problems + gaps, as an artifact) and an automatic pass in **Plan mode** —
`run.ts` wraps `waitForApproval` so the critic reviews the plan and its view
renders beside the plan before the scholar approves. The `supervisor-audit`
playbook gained a `critique` step.

## Consequences

- New: `shared/agent/providers.ts`, `shared/ai/prompts/critique.ts`,
  `electron/ai/{providerConfig,openAiCompatibleClient}.ts`,
  `electron/agent/{openAiCompatTools,modelRouter,critic}.ts`,
  `electron/lib/agentModelAllowlist.ts`. Tests: `agentProviders`,
  `agentProviderConfig`, `agentModelAllowlist`, `openAiCompatTools`,
  `agentCritic`, `byokKeyPanel`.
- `critique` joins the tool registry (26 tools) + the supervisor/review domain
  rule.
- `runPlaybook` signature gains `model`; `dispatch` swaps `generateContentStream`
  → `generateAgentText`; `aiHandlers` key channels take an optional providerId
  and gain `ai:provider`.
- `urlAllowlist.ts` gains `console.groq.com` + `openrouter.ai` for the
  "Get a free key" links.
- `agentEval.live.test.ts` reads `EVAL_PROVIDER`; the same golden set + baseline
  gate every provider.
- Deferred: the reasoning-model critic step; routing claim-check off Gemini.
