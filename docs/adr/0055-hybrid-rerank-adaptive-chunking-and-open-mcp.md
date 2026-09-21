# ADR 0055 — Hybrid reranking with score preservation, adaptive structural chunking, and Open Islamic Knowledge MCP

**Status:** Accepted (revised after review, 2026-09-20) · **Date:** 2026-09-20 · **Milestone:** RAG Quality Upgrades · **Extends:** [ADR-0004](./0004-client-side-text-chunking.md), [ADR-0027](./0027-m9-efficiency-and-intent-precision.md), [ADR-0036](./0036-web-byok.md), [ADR-0038](./0038-hybrid-intent-classification-and-tool-gating.md), [ADR-0041](./0041-rijal-connector-lookup-narrator.md), [ADR-0048](./0048-m11-excel-write-zakat.md)

## Context

1. **Chunk boundaries.** The fixed 1200-character window (ADR-0004) can separate a hadith's isnad from its matn, or a fiqh ruling from its chapter.
2. **Ranking and the Kifayat Gate.** `evaluateKifayatGate` normalises `score` against the maximum RRF score (`0.03278`). A reranker that overwrote `score` with a 0..1 confidence would make every result look confident and permanently disable escalation.
3. **BYOK.** `user_provider_keys` holds chat keys, and `agent-model` takes the most recently updated row as *the* chat provider. A stored Cohere key made `PROVIDERS["cohere"]` undefined, so the handler threw on `spec.baseUrl` — and again on `spec.label` in its own catch — breaking chat for that user until they deleted the key.
4. **Fan-out order.** `islamic-search` concatenates its tiers in a fixed order (A, B, C, K, D, W, L, T) and, until now, sent all of it (~48 rows) to the model.
5. **Interoperability.** External agents want the corpus and the faraid engine over MCP.

## Decision

### 1. Adaptive structural chunking (`shared/text/documentChunks.ts`)

`chunkDocumentAdaptive(text, { kind?, chunkSize?, overlap? })`; the legacy `chunkDocumentText` is **unchanged** (stored offsets, `estimate.ts` and resume all depend on its stride).

- **`hadith`** — one narration (isnad + matn) per chunk when it fits, cut where a line opens with an isnad verb (حدثنا / أخبرنا / أنبأنا / روى …) or a number (`12 -`, `[12]`, `١٢ -`); `meta.isnad` holds the chain.
- **`fiqh` / `classical`** — cut at short heading lines (كتاب / باب / فصل / مسألة / فرع), each chunk carrying its heading trail in `meta.heading`.
- **`prose`** — the legacy window, tagged.
- **Detection** counts transmission verbs (≥ 2 → hadith) or heading lines (≥ 2 → fiqh). The bare word «عن» is **not** a signal: it occurs in nearly all Arabic prose.
- **`normalizeDocumentKind`** maps a library item's `kind`/`discipline`/`category` (which may be "general", "book", "rijal"…) to a strategy or `undefined` = detect. Passing those through raw skipped detection and chunked the item as prose.
- **Implementation notes learned the hard way.** All patterns run on a *plain view* (tashkeel removed, alif folded) with an offset map back to the original, so vowelled and bare texts share one pattern set. **`\b` never matches Arabic in JavaScript** (no boundary between two non-word characters) — the first version used it and never split unnumbered narrations, so three narrations came out as one chunk; explicit Arabic-letter lookarounds are used instead. `charStart`/`charEnd` index the text passed in, so `text.slice(charStart, charEnd)` is the chunk.
- **Determinism.** Same text + options → same chunks; ingest resumes by chunk index. `meta.ingest.chunker = 'adaptive-v1'` is written at ingest and a resume with any other value uses the legacy chunker. (`adaptive-v1` has not shipped, so the algorithm above is still v1.)
- **Scope.** New library imports only. The 373k-row corpus is not re-chunked; Shamela per-page import is unchanged.

### 2. Score preservation and rerank (`_shared/rerank.ts`)

- **`score` (RRF) is never overwritten.** Cohere relevance goes to `rerank_score`.
- **`fuseByGroup`** interleaves rows across their source tier by within-tier rank (RRF with one channel per tier) *before* anything is cut. Without it the first 10 rows of the flat list were all Tier B and the user's library, word-by-word, the classical corpus and Turath could never surface. Rows are tagged with their tier at merge time (`fanOutTiers`); `groupOf` is passed to `fuseAndRerank`. Nothing is reshuffled when nothing needs cutting.
- **Placement in `islamic-search`:** after dedupe, the topic-anchor merge and the `requireArabicMatn` filter (so the cap cannot leave non-Arabic rows to be filtered into an empty list), and before `deriveStrictMode`. Cohere scores the fused head (default 40), returns the top 10 (`RERANK_TOP_N` is the knob if fewer sources shown proves too tight).
- **Anchors are pinned** above the cut and never dropped; at least 3 retrieved slots are kept even with many anchors.
- **Fallback:** 2.5 s timeout; any Cohere failure → fused RRF order.
- **`citationEngine.rerankChannel` (Gemini, `resource-search` only) is left in place**: it emits the Urdu `reason` string that the Trust UI shows, which a cross-encoder cannot. It still has no timeout of its own.
- **Honest limit.** Without a Cohere key this is rank interleaving, not a relevance model. Its value on that path is the bounded, tier-balanced context, and the removal of nothing slow.
- The Cohere key is fetched **concurrently with the fan-out** (`cohereKeyPromise`), not after it, so a user with no key pays no extra round-trip.

### 3. Cohere BYOK, and chat isolation

Order matters — the `agent-model` fix ships before the ability to save a Cohere key:
1. `agent-model` queries only chat providers (`.in("provider", PROVIDER_IDS)`) and additionally guards `PROVIDERS[row.provider]`, so a non-chat row can never reach `spec.baseUrl`.
2. Migration `20260920120000_add_cohere_provider.sql` widens the `provider` CHECK.
3. `byok-keys` accepts `cohere`; its `test` action pings `/v2/rerank` (10 s timeout). `providerRegistry.ts` / `shared/agent/providers.ts` stay chat-only.
4. `WebByokKeyPanel` lists Cohere as a rerank provider.

The migration is applied through Lovable (see the Lovable-managed-backend note); deploy it **before** users can save a key, and deploy the `agent-model` change with or before it.

### 4. Open Islamic Knowledge MCP (`src/lib/mcp/`)

Tools live in `src/lib/mcp/tools/`; `supabase/functions/mcp/index.ts` is **generated** from them by a Lovable cloud build. `vite.config.ts` deliberately omits the plugin (on Windows it writes an absolute local path into the bundle), so **the checked-in function does not contain these tools until a Lovable build regenerates it.** The entry point bundles cleanly with `shared/` imports (verified with esbuild).

- **`search_islamic_corpus`** — *lexical* search over the local corpus via `search_documents_smart(p_terms, p_source_types, p_match_limit)`; `domain` maps to `source_type` values. It is not semantic and does **not** include Turath (the description says so).
- **`takhrij_hadith`** — finds other narrations of a hadith by matn overlap, using the **same** tokenizer and 0.5 threshold as the app's `takhrijHadith`, now defined once in `shared/text/takhrij.ts` (mirrored to Deno) and used by both. A same `hadith_number` in another collection is never a match. It replaces the originally planned `get_hadith_chain`: no isnad transmission graph exists (`trace_isnad` is deferred, ADR-0041) and `jkhssn_sanad_tree` is a desktop-only engine.
- **`calculate_faraid`** — the pure `shared/faraid` engine.

**Lesson.** Both corpus tools first called the RPC with `{ patterns, sub_patterns, max_results }` — names the function does not have — so PostgREST rejected every call. Their tests covered only metadata and the unauthenticated refusal. `mcpCorpusTools.test.ts` now executes the happy path and pins the argument names against the migration that defines the function.

### 5. Chunk Inspector

`libraryChunkService.listChunks(itemId, limit, offset)` on both backends, capped at 200 per page. The cloud query selects only Postgres columns — `page_number`/`part_number` are desktop-only, and selecting them made the query fail into an empty list for every web user. Errors are **thrown** so the dialog can show "could not load" rather than "no chunks". The dialog pages (100 at a time, "Load more", "Showing N of M"), is localised (`library.chunks.*`, en/ar/ur) and follows the app's text direction.

## Consequences

**Positive.** Structural chunks keep isnad with matn; the Kifayat Gate keeps its calibration; a rerank key cannot break chat; every source tier can reach the model; MCP and the app agree on what "the same hadith" means.

**Negative / trade-offs.**
- Sources shown per answer drop from ~48 to 10 (`citationSummaries` derives from the same list). The tier-balanced cut and `RERANK_TOP_N` mitigate; watch for complaints about thin source lists.
- Existing library documents keep legacy chunks until re-ingested.
- Cohere adds up to 2.5 s in the worst case (a timeout), bounded by the fallback.
- MCP tools reach production only via a Lovable cloud build.
