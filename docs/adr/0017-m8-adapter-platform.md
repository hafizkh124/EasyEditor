# ADR 0017 — Adapter Platform + Conversion Graph, Not N² Converters

**Status:** Accepted · **Date:** 2026-08-29 · **Milestone:** SPEC-M8

## Context

The request behind SPEC-M8 is not "add Word export" — it's "let the agent
drive whichever tool a researcher's format requires: Word, InPage, PDF,
PowerPoint, Excel, Maktaba Shamela — the way a skilled human does at their
own computer." Taken literally, that's a combinatorial problem: for *n*
tools, a hand-written converter for every ordered pair is *n²* work, and
every new tool added multiplies the remaining work rather than adding to it
linearly.

A related, narrower question was also on the table: should EasyEditor
reimplement Word-like editing (its own page layout engine, its own footnote
renderer, its own style system) so it doesn't depend on external
applications at all? That was rejected early — the user was explicit that
EasyEditor is not building a Word replacement; it is building an agent that
operates the researcher's existing tools.

## Decision

Two abstractions, not a converter matrix:

1. **One adapter per tool** (`electron/adapters/word.ts`, `excel.ts`,
   `powerpoint.ts`, `libreoffice.ts`, `pdf.ts`, `inpage.ts`, `shamela.ts`),
   each declaring: which formats it reads/writes, which operations it
   exposes, and whether it's present on this machine
   (`electron/host/detect.ts`). Adding a tool means adding one adapter;
   nothing else in the system changes.
2. **A conversion graph** (`shared/convert/`) where formats are nodes and
   adapters' read/write capabilities are weighted edges. "Convert X to Y" is
   a shortest/best-quality-path search over that graph, not a hard-coded
   function per pair — `InPage → RTF → docx → Word → PDF` falls out of the
   graph automatically, without anyone writing an "InPage to PDF" converter.

Every adapter and every conversion edge is built on **driving the real
external application** (Word via COM, LibreOffice via its CLI, InPage via
its own RTF import/export) rather than reimplementing that application's
document model inside EasyEditor. Where an application has no public
automation surface at all (InPage — no COM, no CLI, no scripting API found),
the only honest path is its own interchange format (RTF), explicitly
degraded rather than faked (see SPEC-M8 §4's loss table).

`electron/host/` (`powershell.ts`, `process.ts`) is the one shared runtime
every COM/CLI adapter is built on — a single long-lived automation process
per session, JSON commands over stdio, never a shell string built from model
or user text. `p0-spike/word-bridge.ps1` and `p0-spike/host.mjs` are the
throwaway proof of this exact pattern, written before any of `electron/`'s
real code.

## Consequences

- No adapter is required to know about any other adapter or format — only
  its own inputs/outputs and the graph consumes that declaration.
- The conversion graph must carry loss metadata per edge (SPEC-M8 §4) and
  refuse silently-bad conversions rather than best-effort them; a missing
  edge (no known path) is a clear refusal, not a crash.
- This does not extend to reimplementing any external application's
  document model. If a future adapter has no automatable surface at all
  (like InPage), the answer is a narrower interchange-format bridge and an
  explicit "not fully supported" status in `list_capabilities`, not a
  from-scratch reimplementation of that application inside EasyEditor.
- Platform-specific reality is not hidden: the adapter registry's
  `detect.ts` output is what the agent's `list_capabilities` tool reports,
  so a Windows-only adapter (COM) is simply absent on macOS/Linux rather
  than silently degraded.
