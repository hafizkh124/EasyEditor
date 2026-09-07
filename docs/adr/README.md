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
| [0012](./0012-tafsir-web-via-edge-function.md) | Tafsir MCP on Web via a Session-less Edge Function | Accepted (decision) |
| [0013](./0013-source-picker-and-collection-registry.md) | Opt-in source picker + canonical book registry for scoping (supersedes part of 0002) | Accepted |
| [0014](./0014-classical-discipline-entry-point.md) | Explicit entry point for rijal/tafsir/lughat, plus fixing why they were unreachable at all | Accepted |
| [0015](./0015-m8-word-inpage-p0-spike.md) | M8 desktop document bridge — P0 spike results and the four constraints they lock onto P1 | Accepted |
| [0016](./0016-m8-agentic-loop-supersedes-fixed-tasks.md) | Agentic loop supersedes "the model never chooses the steps," compensated by tracked-change review + grounding gate | Accepted |
| [0017](./0017-m8-adapter-platform.md) | Adapter platform + conversion graph (one adapter per tool, not N² converters) | Accepted |
| [0018](./0018-m8-folder-projects-and-sync.md) | The project folder (docx/rtf) is the source of truth, not an internal document model | Accepted |
| [0019](./0019-m8-context-rules-and-checkpoints.md) | `@` mentions, `قواعد.md`, task checkpoints — and what was deliberately not adopted | Accepted |
| [0020](./0020-m9-playbook-execution.md) | M9 — playbooks are executed by a deterministic step executor, not seeded as advice | Accepted |
| [0021](./0021-m9-bounded-generative-tools.md) | M9 — `draft_section`: substantial drafting via fixed instruction templates, not free-form prompts | Accepted |
| [0022](./0022-m9-agent-reach-into-local-subsystems.md) | M9 — `query_tafseer` + `search_hadith` bridged to existing subsystems (citable); `search_web_scholarly`/Firecrawl rejected; scholarly scraping whitelist widened | Accepted |
| [0023](./0023-m9-ocr-consent-gated-cloud-bridge.md) | M9 — `ocr_document` is a consent-gated renderer→cloud bridge (sticky per-project consent); local OCR stays blocked; OCR output is never a citation | Accepted |
| [0025](./0025-m9-print-layout-scope.md) | M9 — `typeset_print_ready` is a print-ready Word layout, not press-grade typesetting; every call returns a loss list | Accepted |
| [0028](./0028-m9-federated-knowledge-tiers.md) | M9 — `search_repositories` (Archive.org + OpenAlex), bibliographic-only citations, opt-in per project; waqfeya + live OpenITI API rejected | Accepted |
| [0024](./0024-m9-agent-artifact-channel.md) | M9 — the agent artifact channel + live document deltas; "skills" = playbooks + guidance | Accepted |
| [0026](./0026-m9-studio-shell-and-governance-modes.md) | M9 — Ask/Plan/Auto modes (per-write "Manual" rejected); studio shell | Accepted |
| [0027](./0027-m9-efficiency-and-intent-precision.md) | M9 — fast path, dynamic tool pruning, negative boundaries, budgeting, early-stop, ask-vs-guess | Accepted |
| [0029](./0029-m9-author-voice.md) | M9 Phase A — `طرز_تحریر.md` author-voice style file (guidance, not a constraint; addendum to fixed templates; generative writing only) | Accepted |
| [0030](./0030-m9-live-model-eval.md) | M9 Phase B — live-model eval harness (scripted world + real ModelFn; golden set; CI-tested scoring; committed baseline floor); precondition for multi-provider | Accepted |
| [0031](./0031-m9-multi-provider.md) | M9 Phase C — multi-provider routing (Groq + OpenRouter via one OpenAI-compat path; per-provider BYOK keys; eval-gated loop, key-only text-gen; separate outbound allowlist; per-provider privacy notes) | Accepted |
| [0032](./0032-m9-session-memory.md) | M9 Phase E — per-project journal folded into the prompt; history compaction for the model call only; `research_topic` bounded read-only sub-run sharing the parent ledger | Accepted |
| [0033](./0033-m9-disclosure-and-source-view.md) | M9 blueprint §3 — deterministic AI-disclosure ledger + `compile_ai_disclosure` (bilingual front-matter statement); `insert_footnote` emits a citation artifact with the source excerpt for open-before-accept review | Accepted |
| [0034](./0034-unified-research-surface.md) | M10 — unified research surface: auto-derived strictness (no Islamic/General switch), Research+Agent merged into one tab via composition, composer controls consolidated into one hub (supersedes 0002, amends 0026) | Accepted |

## When to write a new ADR

- Choosing between approaches that are both viable.
- Reversing or replacing an earlier ADR.
- A non-obvious constraint shaped the implementation (timeouts, quotas, library limits).

## When **not** to write one

- Routine refactors, bug fixes, dep bumps.
- Decisions already documented in `docs/SPEC-v2.md` Decision Log.
- Things you can read from the code in 30 seconds.
