# Architecture Decision Records

Each ADR captures a non-obvious architectural choice made during v2 — what we
did, what we considered, and why we landed where we did. Use these to
reconstruct rationale without rereading commits.

| # | Title | Status |
|---|---|---|
| [0001](./0001-client-side-audio-chunking.md) | Client-side audio chunking for long-form transcription | Accepted |
| [0002](./0002-three-mode-research.md) | Three-tab research mode (Islamic / Custom Sources / General) | Accepted |
| [0003](./0003-threshold-gated-virtualization.md) | Threshold-gated virtualization for the research chat | Accepted |
| [0004](./0004-client-side-text-chunking.md) | Client-side text chunking for long-document AI runs | Accepted |
| [0005](./0005-m4-personal-corpus-and-graph.md) | M4 personal corpus, knowledge graph, and recipes | Accepted |
| [0006](./0006-workspace-backend-adapter.md) | WorkspaceBackend Adapter facade pattern (Web vs Desktop) | Accepted |
| [0007](./0007-shamela-native-read.md) | Reading a local Shamela 4 library (SQLite + Lucene via Shamela's own JRE) | Accepted |
| [0008](./0008-local-voice-engines.md) | Python-free Local Voice Core (Piper ONNX, Whisper, Segmented Synthesis) | Accepted |
| [0009](./0009-voice-studio-implementation.md) | Voice Studio Implementation Patterns (CLI spawn, IPC progress, MediaRecorder cloning) | Accepted |
| [0010](./0010-workspace-is-the-single-home.md) | Workspace Is the Single Home (retiring standalone editor/research/book/translate pages) | Accepted |
| [0011](./0011-elevation-typography-charter.md) | Elevation & Typography Charter (design tokens + `check-ui-discipline.mjs` enforcement) | Accepted |

## When to write a new ADR

- Choosing between approaches that are both viable.
- Reversing or replacing an earlier ADR.
- A non-obvious constraint shaped the implementation (timeouts, quotas, library limits).

## When **not** to write one

- Routine refactors, bug fixes, dep bumps.
- Decisions already documented in `docs/SPEC-v2.md` Decision Log.
- Things you can read from the code in 30 seconds.
