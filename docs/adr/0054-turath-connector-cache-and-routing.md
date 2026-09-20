# ADR 0054 — Turath.io classical library connector, two-tier cache, and fallback routing

**Status:** Accepted · **Date:** 2026-09-20 · **Milestone:** Turath Integration (Phase 0/1) · **Extends:** [ADR-0007](./0007-shamela-native-read.md), [ADR-0014](./0014-classical-discipline-entry-point.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md), [ADR-0044](./0044-cloud-shamela-connector.md)

## Context

EasyEditor provides 8 scholarly playbooks (`study_masala`, `quran_exegesis`, `fiqh_ruling`, `comparative_fiqh`, `hadith_verification`, `ilm_al_rijal`, `balagha_analysis`, `nahw_sarf`). In `src/lib/prompts/promptsRegistry.ts`, these prompts have remained gated behind `corpusReady: false` because classical Arabic disciplines (fiqh, tafsir, lughat, nahw, rijal, sirah) lack full local or cloud corpus coverage:
1. **Local Shamela (ADR-0007):** Demands a multi-gigabyte disk footprint and a bundled JRE, which web users and lightweight desktop installations do not have.
2. **Cloud Shamela (ADR-0044):** `shamela.link/mcp` provides high-quality retrieval, but requires OAuth onboarding, per-account quotas, and external account provisioning.

**Turath.io** (`https://api.turath.io`) indexes ~8,500 classical Islamic works (~3.5+ million pages) with public REST endpoints (`/search?q=...&ver=3`, `/page/...`, `/book/...`). It provides immediate, zero-credential access to classical texts across fiqh schools, Hadith commentaries, Arabic lexicons, and tafsir.

Integrating Turath.io requires solving four architectural challenges:
1. **Unified Routing without Tool Proliferation:** Adding another set of tools would confuse intent classification and overwhelm context windows.
2. **API Structure & Normalization:** The Turath API returns `{book_id, cat_id, author_id, meta, snip, text}` where `meta` is a serialized JSON string containing `{headings, page_id, page, vol, book_name, author_name}`, snippets contain HTML `<em>` highlight tags, and there is no canonical URL field.
3. **Passage Deduplication:** In cross-tier retrieval (`islamic-search`), fatwa and classical rows historically relied on URLs for deduplication. Turath rows have no URLs; without an explicit identity rule, passages from Tier D (pre-ingested classical corpus) and Tier T (live Turath API) would collide or duplicate.
4. **Caching & Latency SLA:** Network round trips to Turath must not slow down iterative research or repeatedly fetch static historical pages.

## Decision

### 1. Three-Tier Routing Behind `shamelaRouter.ts`

Rather than introducing distinct agent tools, the agent retains the canonical tool triad: `search_shamela`, `read_shamela_page`, and `find_shamela_book`.

`electron/agent/adapters/shamelaRouter.ts` extends its resolution order into a three-tier fallback pipeline:
$$\text{Local Shamela} \longrightarrow \text{Cloud Shamela} \longrightarrow \text{Turath.io}$$

1. **Local Shamela First:** If local Shamela is enabled and healthy, it is invoked. If local search succeeds — *including returning zero hits* — that result is authoritative and returned directly.
2. **Cloud Shamela Fallback:** If local is disabled, uninstalled, or throws (e.g. missing JRE or corrupt index), routing falls back to `shamela-cloud`.
3. **Turath.io Fallback:** If cloud Shamela is disabled or fails, routing automatically falls back to `turath` (`turathClient.ts`).
4. **Direct Reference Routing:** For `read_shamela_page`, the id prefix dictates direct routing:
   - `shamela:` $\rightarrow$ Local Shamela
   - `shamela-cloud:` $\rightarrow$ Cloud Shamela
   - `turath:` $\rightarrow$ Turath client (`readTurathPage`)

`routeShamelaFindBook` fixes the previous fall-through bug by cascading catalogue searches through all enabled providers until matches are found.

### 2. Connector Registry and Multi-Owner Tools

Following the multi-owner pattern established in ADR-0044:
- `turath` is registered in `shared/agent/connectors.ts` with `category: 'islamic'`, `healthKind: 'ping'`, and default `enabled: true`.
- `turath.tools` is registered with `['search_shamela', 'read_shamela_page', 'find_shamela_book']` in `MULTI_OWNER_TOOLS`. A shared tool is disabled only when *every* owning connector is disabled.
- Intent gating (ADR-0038) remains transport-agnostic.
- Provenance tracking inspects `chunk.transport`: `'local'` $\rightarrow$ `shamela`, `'cloud'` $\rightarrow$ `shamela-cloud`, `'turath'` $\rightarrow$ `turath`.

### 3. API Normalization & Defensive Parsing

`turathClient.ts` (Desktop) and `supabase/functions/_shared/turath.ts` (Cloud Tier T) enforce defensive normalization:
1. **JSON String Parsing:** `meta` is safely parsed with try-catch fallback. Missing metadata fields default to empty headings, volume `1`, and unknown book/author labels.
2. **HTML Tag Stripping:** `<em>` and `</em>` search highlight tags in `snip` and `text` are stripped via regex (`/<[^>]+>/g`) so raw HTML never leaks into embeddings, UI citations, or LLM contexts.
3. **Attribution Integrity:** Because Turath provides no external URL, the normalizer constructs synthetic citation locators referencing `{ book_id, page, volume, headings }` without fabricating nonexistent HTTP links.

### 4. Cross-Tier Result Identity (`resultIdentity.ts`)

To prevent duplicate citations when Tier D (stored embeddings) and Tier T (live Turath) retrieve the same text, `supabase/functions/_shared/resultIdentity.ts` adds a `book_id + page` fallback branch:

```typescript
const bookId = c.book_id;
const page = c.page;
if (
  bookId != null && String(bookId).trim() !== "" &&
  page != null && String(page).trim() !== ""
) {
  return `classical:${String(bookId).trim()}:${String(page).trim()}`;
}
```

This guarantees:
- Identical classical passages from both tiers collapse to a single result entry.
- Rows missing either `book_id` or `page` return `null` and are never dropped.
- Blank or whitespace strings are strictly ignored.

### 5. Two-Tier Caching Architecture

Both Desktop and Cloud implement a 2-tier cache:
1. **L1 Memory Cache:** In-memory LRU map for zero-latency turn-to-turn retrieval within an active session.
2. **L2 Persistent Cache:**
   - **Desktop:** `userData/turath-cache.json` persisted to disk across app restarts.
   - **Cloud:** `api_response_cache` Supabase table keyed by hashed query/endpoint.
3. **TTLs:**
   - Page text (`readTurathPage`): **7 days** (historical book pages are immutable).
   - Search queries (`searchTurath`): **24 hours**.
4. **Cache Invariant:** Errors (timeouts, HTTP 429/5xx, network drops) are **never cached**.

### 6. Resilience, Rate Limiting, and Concurrency

- **Concurrency Limit:** Global concurrency limiter restricts simultaneous outbound Turath requests to 2.
- **Timeouts:** Fixed 12,000ms (12s) AbortSignal timeout on all fetch operations.
- **Graceful Degradation:** A failed Turath call degrades retrieval gracefully without breaking the agent loop or throwing unhandled rejections.

## Consequences

### Positive
- Unlocks the 8 classical research prompts without requiring users to download multi-gigabyte Shamela archives.
- Transparently provides classical book retrieval to both Desktop and Web users.
- Caching prevents redundant network calls and guarantees snappy repeated queries.
- Clean deduplication prevents duplicate source cards in the citation panel.

### Negative & Trade-offs
- Turath search snippets occasionally lack surrounding context; agent must use `read_shamela_page` (`turath:`) for deep verification of lengthy legal passages.
- Dependent on third-party availability of `api.turath.io`, mitigated by 2-tier caching, short timeouts, and fallback to Tier D corpus.
