# ADR 0055 — Hybrid reranking with score preservation, adaptive structural chunking, and Open Islamic Knowledge MCP

**Status:** Accepted · **Date:** 2026-09-20 · **Milestone:** RAG Quality Upgrades (Phase 0/2/3) · **Extends:** [ADR-0004](./0004-client-side-text-chunking.md), [ADR-0027](./0027-m9-efficiency-and-intent-precision.md), [ADR-0036](./0036-web-byok.md), [ADR-0038](./0038-hybrid-intent-classification-and-tool-gating.md), [ADR-0041](./0041-rijal-connector-lookup-narrator.md), [ADR-0048](./0048-m11-excel-write-zakat.md)

## Context

EasyEditor's RAG pipeline operates across multiple heterogeneous tiers (Tier A APIs, Tier B vector embeddings, Tier K BM25/lexical, Tier D classical corpus, Tier W word-by-word glosses, and Tier T Turath live API). As we expand classical research to ~8,500 books, three retrieval bottlenecks emerge:

1. **Chunk Boundary Degradation:** Fixed-size character or word chunking (ADR-0004) severs semantic structures in classical Arabic literature. In Hadith literature, splitting an *isnad* (chain of transmitters) from its *matn* (saying/action) yields ungrounded or orphaned narrations. In fiqh and tafsir, splitting arbitrarily across *bab* (chapter) or *fasl* (section) boundaries disconnects legal rulings from their conditioning context.
2. **Ranking Precision & The Kifayat Gate Invariant:** Reciprocal Rank Fusion (RRF) provides recall across lexical and semantic streams, but lacks deep cross-encoder re-scoring. Adding cross-encoder reranking (e.g. Cohere Multilingual v3 via BYOK) introduces a subtle safety hazard: EasyEditor's `Kifayat Gate` monitors escalation thresholds based on RRF scores (threshold $\approx 0.03278$). If a reranker overwrites `score` with normalized $0..1$ confidence values, every result would exceed the threshold, permanently suppressing necessary escalation and grounding checks.
3. **BYOK Provider Conflicts:** EasyEditor allows BYOK API keys (ADR-0031, ADR-0036). If a user provides a Cohere API key for reranking, `agent-model/index.ts` auto-loads user provider keys. Because `PROVIDERS['cohere']` is not a registered text-generation provider, referencing `spec.baseUrl` throws an unhandled exception that crashes the chat pipeline on startup.
4. **Open Interoperability:** External agents and researchers require standardized access to EasyEditor's curated Islamic corpus and specialized calculation engines via the Model Context Protocol (MCP).

## Decision

### 1. Structural Adaptive Chunking (`shared/text/documentChunks.ts`)

We introduce `chunkDocumentAdaptive(text, { kind, maxTokens, overlapTokens })`:
- **`kind: 'hadith'`:** Identifies isnad and matn marker patterns (e.g., حدّثنا, أخبرنا, عن, قال, أن رسول الله ﷺ), treating each narration (isnad + matn) as an indivisible structural unit whenever within token limits.
- **`kind: 'fiqh'` & `'classical'`:** Detects hierarchical headings (كتاب, باب, فصل, مسألة, فرع) and segments along natural boundaries, prepending parent heading breadcrumbs to each chunk.
- **`kind: 'prose'`:** Falls back to paragraph- and sentence-boundary sliding windows.
- **Ingest Metadata:** Ingest pipelines (`library-ingest/index.ts` and Desktop local ingestion) stamp chunks with `meta.ingest.chunker = 'adaptive-v1'` to enable version-aware migration and reindexing.

### 2. Score Preservation & Dual Scoring Architecture

In `supabase/functions/_shared/rerank.ts` and `citationEngine.ts`:
- **`score` (RRF) is Immutable:** The original RRF score remains stored in `score`. The `Kifayat Gate` evaluates only `score`, preserving its calibrated threshold behavior.
- **`rerank_score` for Top-K Ordering:** Cross-encoder rerank relevance scores ($0..1$) are written to a dedicated `rerank_score` property.
- **Urdu Trust Explanations Preserved:** `rerankChannel`'s qualitative Urdu reasoning string (`reason`) is retained for UI trust display. Cohere's purely quantitative output never overwrites human-readable justifications.

### 3. Pipeline Filter and Anchor Ordering

In `supabase/functions/islamic-search/index.ts`, retrieval stages follow a strict topological order:
1. **Candidate Gathering:** Up to 30 candidates pooled from active tiers (RRF fused).
2. **Content & Language Filtering:** Diacritic-tolerant Arabic filtering (`has_matn`) and discipline filtering execute *before* reranking cap truncation. This prevents non-Arabic rows from consuming the top-10 slots and being discarded, leaving an empty pool.
3. **Topic Anchor Protection:** User-selected topic anchors are pinned at the top and exempted from reranking pruning.
4. **Hybrid Rerank & Cap:** Reranking scores the remaining pool; the top $K$ (default 10) are retained.
5. **Strict Mode Derivation:** `deriveStrictMode` executes on the finalized list.

### 4. Cohere BYOK Plumbing & Chat Crash Isolation

- **Chat Isolation:** `supabase/functions/agent-model/index.ts` modifies its BYOK query to restrict fetched keys to known text-generation providers (`WHERE provider IN ('openrouter', 'groq', 'openai', ...)`), explicitly excluding `cohere`.
- **Dedicated Rerank BYOK:** In `WebByokKeyPanel.tsx` and `byok-keys/index.ts`, Cohere is categorized under "Rerank Provider".
- **Resilient Fallback:** The rerank client sets an aggressive 2,500ms (2.5s) timeout. If the Cohere API times out, fails, or has invalid credentials, the pipeline silently logs the error and falls back to RRF ordering.

### 5. Open Islamic Knowledge MCP Server (`src/lib/mcp/`)

We implement an open MCP server exposing three high-discipline tools:
1. **`search_islamic_corpus`:** Unified hybrid retrieval across Quran, Hadith, fatwa, and Turath classical books.
2. **`takhrij_hadith`:** Higher-order composition tool. Rather than accepting raw unverified text or attempting unindexed isnad graph walks (`trace_isnad` remains deferred per ADR-0041), it takes an `EngineCitation` candidate list, cross-checks collection numbers, and outputs standardized takhrij comparisons.
3. **`calculate_faraid`:** Deterministic Islamic inheritance calculator implementing the Jumhūr consensus rules (ADR-0048).

## Consequences

### Positive
- Structural chunking maintains isnad-matn coherence and preserves fiqh chapter context.
- Kifayat Gate safety and escalation dynamics remain intact while enjoying cross-encoder ranking precision.
- Adding a Cohere key enhances search ranking without destabilizing chat generation models.
- Standardized MCP server allows external tools to query EasyEditor's classical knowledge base.

### Negative & Trade-offs
- Re-chunking existing documents requires background migration or re-ingest for pre-indexed documents (`adaptive-v1` tag enables phased updates).
- Cross-encoder reranking adds up to 2.5s latency to retrieval when a BYOK key is enabled, mitigated by the strict timeout fallback.
