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
provider into all three. claim-check stays on Gemini for now (JSON-mode output
varies by provider).

**Per-provider BYOK keys.** `electron/ai/keyStore.ts` generalised to
`byok_<id>.enc` (the Gemini file name is unchanged); a headless / eval run
falls back to `<ID>_API_KEY`. The M8 `getDecryptedGeminiKey` etc. are kept as
aliases.

**A hard verification gate.** `electron/ai/providerConfig.ts` persists
`{ active, verified }`. `setActiveProviderId` refuses a non-Gemini provider
that is not in `verified`. A provider is marked verified from the Settings
panel — which shows the exact `EVAL_PROVIDER=<id> AGENT_EVAL_LIVE=1 …` command —
after the scholar has seen it clear the eval. `AGENT_VERIFIED_PROVIDERS` can
force-verify for CI.

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
- **Free-tier rate limits.** Groq's free tier is tokens-per-minute limited; our
  system prompt + tool schemas make each request large, so a back-to-back
  9-scenario eval run hits 429 after the first one or two (which DO pass the
  full Groq path — retrieve, tool-call, cite — so the adapter is sound). The
  client now retries a 429 with `retry-after` backoff, and the eval sleeps 8s
  between scenarios for a non-Gemini provider. Clearing the whole baseline on
  Groq needs `GROQ_TOOL_MODEL=openai/gpt-oss-20b` (smaller/faster) or a paid
  Groq tier.

## Consequences

- New: `shared/agent/providers.ts`, `electron/ai/{providerConfig,openAiCompatibleClient}.ts`,
  `electron/agent/{openAiCompatTools,modelRouter}.ts`,
  `electron/lib/agentModelAllowlist.ts`. Tests: `agentProviders`,
  `agentProviderConfig`, `agentModelAllowlist`, `openAiCompatTools`,
  `byokKeyPanel`.
- `runPlaybook` signature gains `model`; `dispatch` swaps `generateContentStream`
  → `generateAgentText`; `aiHandlers` key channels take an optional providerId
  and gain `ai:provider`.
- `urlAllowlist.ts` gains `console.groq.com` + `openrouter.ai` for the
  "Get a free key" links.
- `agentEval.live.test.ts` reads `EVAL_PROVIDER`; the same golden set + baseline
  gate every provider.
- Deferred: the reasoning-model critic step; routing claim-check off Gemini.
