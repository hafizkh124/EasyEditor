# ADR 0021 — Bounded Generative Tools (`draft_section`)

**Status:** Accepted · **Date:** 2026-09-03 · **Milestone:** SPEC-M9

## Context

SPEC-M8 §7 states the agent "never improvises a free-form prompt against the
underlying model for content generation — it selects and sequences from the
registry's bounded commands." That held for M8, whose writes were all
transformations of existing text (the 12 `run_task` slugs). Four M9 use cases —
audio → literary-Urdu chapter (1), thematic paper (3), analytical column (7),
academic translation (9) — inherently need the agent to *write new prose*.

## Decision

Substantial drafting is done by a **closed tool with a fixed set of instruction
templates**, exactly the pattern `run_task` uses for its 12 slugs — not a
free-form prompt.

- `shared/ai/prompts/draftSection.ts` (pure) — `DRAFT_MODES` keyed by
  `outline | prose | column | translation | summary | literary-urdu`. Each has
  one fixed `instruction`. The caller passes only `{ mode }`; it never supplies
  or influences the generation prompt.
- `draft_section` params: `{ chapter, mode, section_heading?, source_ids? }`.
- **Grounded modes** (`prose`, `column` with sources, `translation`,
  `literary-urdu`) resolve every `source_id` through `RetrievalLedger.
  resolveOrThrow` — the same gate `insert_footnote` uses — and error on an empty
  or unresolvable list. Checking only that the array is non-empty would let a
  grounded draft cite an id that was never retrieved (M9 defect #5).
- Every instruction forbids asserting anything not in the supplied excerpts, and
  emits bare `[N]` markers for later citation rather than writing reference
  text.
- Output lands as a Word tracked change (via the existing `word.applyTextTask`
  compare path) prefixed `[DRAFT — review every claim]`, and is mirrored to a
  live `document` artifact (ADR-0024).

## How this squares with ADR-0016's four controls

1. **Closed vocabulary** — `mode` is an enum; the model cannot widen it.
2. **Tracked changes** — every draft is a reviewable revision, never a silent
   overwrite.
3. **Citation gate reused** — grounded drafts cannot reference an unretrieved
   source.
4. **Transcript recorded** — the call, its mode, and the source count land in
   `task_runs` → the Trust tab.

## `literary-urdu` is not grounded — and why that is not a loophole (Phase 5)

`literary-urdu` exists for one job: a recorded lecture has been transcribed into
the chapter, and it must become book prose. It **recasts text the chapter
already holds**; it does not compose from retrieved sources. Requiring
`source_ids` would block the very use case, so the mode is `grounded: false`.

The anti-invention guarantee moves into the instruction instead, and is
test-enforced (`agentDraftSection.test.ts`): every idea, ruling, quotation and
attribution must already be in the material; nothing may be added; it is a
recasting, **not a summary**, so nothing may be dropped either; Qur'ānic verses
and hadith stay verbatim; and a sourced sentence gets a bare `[N]` marker so the
citation is attached afterwards by `insert_footnote` — the model still never
writes reference text.

## Transcription needs no new binary (Phase 5)

`transcribe_media` was expected to force a choice between bundling ffmpeg
(+20–30 MB, an LGPL/GPL review) and adding a decode op to the Python sidecar.
Neither is needed. whisper.cpp reads only 16 kHz mono WAV, but the
decode → silence-seam chunk → WAV pipeline already ships in the renderer
(`src/lib/audio/chunker.ts`, ADR-0001) and is what the Transcribe page and the
mic dictation both use. So `transcribe_media` is **renderer-bridged**, exactly
like `search_general` (ADR-0019 item 7): main asks the panel to run the existing
pipeline and gets segments back; `electron/agent/adapters/transcribe.ts` turns
them into a timestamped `sources/<name>.transcript.txt`, recorded in the task
checkpoint so "Undo this task" removes it.

The transcript is then handed to `create_chapter` by **path**
(`from_source`), never pasted back through a tool call — a 45-minute lecture
must not travel through the model's output.

## Consequences

- The 14 scholarly prompt templates in `src/lib/prompts/promptsRegistry.ts`
  informed the wording of the matching modes (`kitabat_maqal` → `column`,
  `khittat_bahth` → `outline`). The Research-tab modal is unchanged; the
  templates are not moved.
- A per-mode `targetLanguage` is threaded for `translation`.
- `.txt` / `.md` became project assets so a transcript is `@mentionable` and
  readable by `create_chapter`.
- Video containers depend on the browser's `decodeAudioData`; when it refuses,
  `chunker.ts` already returns a clear "convert to MP3/M4A" message, which the
  tool surfaces rather than failing opaquely.
