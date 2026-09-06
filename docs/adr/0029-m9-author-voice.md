# ADR 0029 — Author Voice (طرز_تحریر.md)

**Status:** Accepted · **Date:** 2026-09-06 · **Milestone:** SPEC-M9 (Phase A)

## Context

The agent can draft and rewrite prose (`draft_section`, and the rewriting
`run_task` slugs), but every generation runs on a fixed, generic instruction
template. Nothing lets a scholar say "write like the rest of my book" — the
register, sentence rhythm, connectives, and preferred terminology of the
author's own hand. World-class writing assistants close this gap with a
**style file**, not fine-tuning: an editable brief that rides on top of the
base model.

EasyEditor already has the exact mechanism for this in `قواعد.md` — a
human-readable file at the project root, read by `run.ts`, capped, and injected
into the system prompt.

## Decisions

**A file, mirroring قواعد.md.** `طرز_تحریر.md` (aliases `طرز-تحریر.md`,
`tarz.md`, `VOICE.md`) at the project root. `run.ts` reads it with the same
`readRootDoc` helper as the rules file. `shared/agent/authorVoice.ts` (pure)
owns the filename list, the 3000-char cap, and the two formatting helpers.

**Guidance, not a constraint.** قواعد.md is "what always holds" (citation
style, madhhab, numbering) and keeps the last word — the voice section is
pushed into the system prompt *before* it (`systemPrompt.ts`), and every
injected block states that it never overrides قواعد.md, the sources, or a
citation marker.

**An addendum, never a replacement.** `withAuthorVoice(instruction, raw)`
appends the voice to `draft_section`'s mode template / a voice-shaped
`run_task` prompt. The caller still passes only a `mode` / slug, never a
prompt — the closed-vocabulary guarantee (ADR-0016 c1, ADR-0021) is intact.

**Generative writing only.** `VOICE_SHAPED_TASKS` = `formalize`, `humanize`,
`paraphrase`, `shorten`, `summarize`, `summarize_sections`. The mechanical
passes (`add_harakat`, `spelling_check`, `normalize_script`, `auto_format`)
never get the voice — their whole point is to change nothing but the one thing
they fix. `draft_section` gets it for every mode.

**Threaded through the session.** `AgentSession.authorVoice` carries the file
contents to `dispatch.ts` the same way `projectRoot` / `checkpointId` do.

**Discoverability.** When `draft_section` runs with no voice file it returns
`voiceApplied: false` and a one-line note telling the scholar to add a
`طرز_تحریر.md`. A generator that bootstraps the file from the author's prior
chapters (`extract_author_voice`) is deferred to a follow-up — the core value
lands with the file written by hand, as scholars already do for قواعد.md.

## Consequences

- `SystemPromptInput` gains `authorVoice?: string | null`; `AgentSession`
  gains `authorVoice?: string | null`. Both optional — absent is a full no-op.
- Tests: `agentAuthorVoice.test.ts` (the pure module + prompt placement);
  `agentDispatch.test.ts` gains the `draft_section` / `run_task` wiring cases.
- No new tool, no toolScoping change, no IPC change in Phase A.
