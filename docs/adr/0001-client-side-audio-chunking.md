# ADR 0001: Client-side audio chunking for long-form transcription

- **Status:** Accepted
- **Date:** 2026-04-26
- **Spec reference:** SPEC-v2 §FR-3, §5.4, §8

## Context

V2 raised the transcription cap from short clips (~25 MB) to a 60-minute hard
limit. The Gemini-backed `transcribe` edge function is stateless and bound by
the Supabase Edge Functions 60-second wall clock, which makes a single-shot
call infeasible for long audio.

The spec sketched two possible designs:

1. **Server-orchestrated multipart upload** — a new `transcribe/init` +
   `transcribe/finalize` pair, signed-URL chunk uploads, server-side
   reassembly, polling/WebSocket progress channel.
2. **Client-side chunking with stateless per-chunk calls** — slice the audio
   in the browser, call the existing edge function once per chunk, reassemble
   text in order on the client.

## Decision

**Adopt option 2: client-side chunking with stateless per-chunk calls.**

The browser decodes the audio with the Web Audio API, slices the resulting
`AudioBuffer` into ~5-minute segments with silence-aware boundary nudging
(±10 s), and sends each chunk to the existing `transcribe` edge function as a
16 kHz mono WAV. Progress is reported via local events; cancellation uses
`AbortSignal`.

## Rationale

- **No new edge functions.** The existing `transcribe` function already
  handles per-chunk auth, rate-limiting, and quota accounting correctly. A
  multipart protocol would have duplicated all of it.
- **Stays inside Edge Function timeout.** Each ~5-minute chunk is well under
  the 60 s wall clock, so we never need streaming or background workers.
- **No server-side state.** No upload-id table, no orphan-cleanup job, no
  polling endpoint. Cancellation is local and immediate.
- **Matches spec §8 risk mitigation.** The risk register explicitly calls out
  "Edge function 60s timeout" → "Chunking + stateless per-chunk calls."

## Consequences

**Positive**
- Smaller surface area: one new client module (`src/lib/audio/`) and a
  trivial server-side per-call duration cap.
- Cancellation is instant — there is no in-flight server job to abort.
- Per-chunk failures fail loud and isolated (one chunk's HTTP error doesn't
  corrupt the others).

**Negative**
- The browser must decode the entire file into memory before slicing. A
  60-minute mono file at native rates can briefly hold ~600 MB+ of decoded
  PCM. Mitigated by the 60-min hard cap and the immediate downsample to
  16 kHz mono per chunk before encoding.
- Resumability is bounded — we persist the partial transcript to
  `user_sessions` after each chunk completes (FR-3.7), so a reload preserves
  the work already done. The user still has to re-upload the source audio
  to continue from where the cancel happened; we don't keep the source file.
- Server-enforced 60-min total cap is indirect — we cap each call at 600 s
  and rely on the cumulative tier quota (`transcription_limit`) to bound abuse.

## Follow-ups

- Source-audio resumability would need either client-side IndexedDB caching of
  the decoded buffer or signed-URL persistence on the server. Both are large
  and not currently planned.
