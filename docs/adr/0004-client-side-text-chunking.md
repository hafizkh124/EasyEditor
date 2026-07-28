# ADR 0004 — Client-side, block-aware chunking for long-document AI runs

**Status:** Accepted · **Date:** 2026-07-28 · **Milestone:** M3.4 (SPEC-M3 FR-5)

## Context

`refine-text` rejects any payload over 12,000 characters, so an AI action could
not run on a real book at all — the user got "select some text, or run it in
parts" and nothing else. SPEC-M2 deferred the fix to M3 as FR-9.4.

Three properties of the existing system shape the answer:

- **`refine-text` is non-streaming and rate-limited to 30 requests per user per
  minute** (`supabase/functions/refine-text/index.ts`). A long run is therefore a
  sequence of ordinary requests that must be paced.
- **The document is Tiptap JSON, not text.** Headings, blockquotes, lists and
  tables are nodes; flattening them to a string and writing the result back
  destroys the structure the scholar built.
- **Tokens are debited per request, server-side**, and refunded only on gateway
  failure. A run that starts without enough balance leaves a half-processed
  document.

A first implementation split the plain text at `\n\n` every ~2,000 characters,
assembled all the results, and wrote them over the document at the end. It passed
its tests and was wrong in three ways: it fired ~30 requests with no pacing (a
guaranteed 429 partway through), it discarded all completed work when the user
cancelled, and it destroyed every heading, list and table in the document.

## Decision

**Chunk the ProseMirror document, not the text; orchestrate on the client; apply
each batch the moment it returns.**

1. **Block-aware planning** (`src/lib/editor/docChunker.ts`). Walk top-level
   nodes. `table`, `image`, `horizontalRule` and `codeBlock` are never sent and
   never overwritten — only counted. `heading`, `blockquote` and lists each get
   their own batch applied to the block's *inner* range, so the node type
   survives. Consecutive paragraphs group into ≤8,000-character batches.
   Oversized blocks split at Urdu/Arabic sentence terminators (`۔ ؟`).

2. **Position mapping** (`src/lib/editor/positionTracker.ts`). Every planned
   range is pushed through each transaction's `mapping`. This handles both our
   own applies (each result differs in length from the text it replaced) and the
   user typing during the run. A range that collapses is marked invalid and
   skipped rather than written at a guessed position.

3. **Client orchestration** (`src/lib/tasks/chunkOrchestrator.ts`), following
   ADR 0001's audio precedent: serial dispatch, `AbortSignal`, progress events.
   Batches are paced at 2.4s (~25/min) with one backoff-retry on 429. Each result
   is applied immediately, so cancelling keeps everything already written and the
   editor's existing 1.5s autosave persists it with no extra code.

4. **Money is confirmed, then metered.** A multi-batch run always shows a dialog
   naming the batch count, estimated cost and current balance. During the run a
   local ledger decrements per batch and stops the run gracefully when the next
   batch is unaffordable, instead of firing requests that will 402.

## Consequences

**Good**

- A 60,000-character document runs to completion with its headings, quotes,
  lists and tables intact; tables are reported as skipped, not silently eaten.
- Cancel is safe and useful: partial work is real work, already saved.
- No new infrastructure — no queue, no worker, no job table beyond the
  `task_runs` row that already existed.
- One failing batch costs one paragraph, not the run. (This differs deliberately
  from ADR 0001, where a missing audio chunk makes the transcript useless.)

**Bad / accepted**

- **A long run is slow by design.** 25 batches take about a minute. The progress
  bar names the throttle explicitly so the pacing does not read as a hang. If the
  server-side limit is ever raised, `THROTTLE_MS` is the single knob.
- **The run dies with the tab.** There is no server-side job to resume. Partial
  results are in the document and autosaved, which is most of the value;
  cross-reload resume was scoped as a stretch goal and cut.
- **Track changes cannot cover a chunked run.** `applyAsSuggestion` refuses
  multi-line output, so a chunked run with AI Review on would silently bypass
  review. Chunked runs are blocked while review is on rather than pretending.
- **Batch boundaries are not semantic.** A task whose output depends on the whole
  document (`summarize`) is marked non-chunkable rather than producing a summary
  of parts and calling it a summary of the whole.

## Alternatives considered

**Server-side background job.** Survives a closed tab and centralises rate
limiting. Rejected for M3: it needs a queue, a worker and a polling or realtime
channel, and it puts the document mutation far away from the editor that owns the
positions. Revisit if resume-after-reload becomes a real user need.

**Plain-text chunking with a single write at the end.** Simplest to build, and
what the first implementation did. Rejected because it cannot preserve node
structure and makes cancellation worthless.

**Applying results back-to-front to avoid offset drift.** Fixes our own applies
but not concurrent typing, and makes the progress bar count backwards.
`transaction.mapping` solves both in about twenty lines.

## References

- `docs/SPEC-M3.md` §3 FR-5, §6 R1–R3
- [ADR 0001](./0001-client-side-audio-chunking.md) — the audio precedent
- `src/lib/audio/transcribeLongForm.ts` — the orchestrator shape this mirrors
