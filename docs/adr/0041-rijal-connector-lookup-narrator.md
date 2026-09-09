# ADR 0041 — علم الرجال connector: `lookup_narrator` over the existing corpus

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub (Phase 5) · **Extends:** [ADR-0014](./0014-classical-discipline-entry-point.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md)

## Context

Phase 5 of the Connectors Hub plan was "bundle `arriqaaq/ilm` as a downloadable
local MCP" for narrator biographies + an 18k-narrator graph + isnād-chain tracing.

**The spike ruled that out.** `arriqaaq/ilm` is a Rust + SurrealDB + Ollama
self-hosted platform: no release binaries (`cargo build` from source), and its
MCP mode (`hadith mcp`) requires the full multi-GB dataset ingested locally
first (`make pipeline-full`, auto-downloads several GB) with a running Ollama
(`command-r7b-arabic`). There is no hosted `ilm` API. None of that can be
bundled with, or auto-installed by, EasyEditor for a scholar's machine.

What EasyEditor already has (ADR-0014): ~19.6k classical narrator biographies in
`scholarly_documents` (`classical-rijal` discipline), plus per-book narration
counts — reachable today only through the generic `search_hadith` channel, which
does not scope to rijāl and mixes narrator questions in with hadith search.

The user's decision: **ship `lookup_narrator` now over that corpus; defer the
graph** (`trace_isnad`) until a transmission dataset is ingested.

## Decision

### No new data source — a scoped query into Tier D

`islamic-search`'s Tier D (`classicalChannel`) auto-fires when `planQuery`
detects the `rijal` discipline in the question. `shared/agent/rijalQuery.ts`
(pure) shapes `{ name, aspect }` into an Arabic query that reads unmistakably as
a rijāl question — `ترجمة الراوي «<name>» في كتب أسماء الرجال — <aspect focus>
(رجال، جرح وتعديل، تراجم الرواة)`. `aspect` ∈ `biography | grade |
teachers-students | narration-count` steers the focus phrase.

`dispatch.ts`'s `lookup_narrator` case sends that through the **existing
renderer research bridge** (`researchSearch('islamic', …)`, the same path
`search_hadith` uses — the agent loop can't reach signed-in edge functions from
the main process, ADR-0022), maps the returned citations to citable
`RetrievedChunk`s (`id: <domain>:rijal:<book>:<key>`), adds them to the ledger,
and emits a `citation-list` artifact. **Zero new plumbing** — no MCP client, no
IPC channel, no download, no schema change.

### The connector, and gating

`rijal` connector: `category: 'hadith-rijal'`, `healthKind: 'bridged'`
("checked at query time via your signed-in session"), **ships enabled**.
`toolScoping` gains a rijāl `DomainRule` **between the grading rule and the
general hadith rule** with `connector: 'rijal'` (keywords: راوی کا حال / ترجمة
الراوي / جرح وتعديل / اسماء الرجال / شیوخه / تلاميذه / …). All three rules share
the `hadith-rijal` category, so `classifyIntent` (ADR-0038, ADR-0040) collapses
them to the most-specific match: a narrator question → `rijal`, a grading
question → `dorar`, a topical hadith search → `hadith`.

`lookup_narrator` joins `CITABLE_SEARCH_TOOLS`.

### What is deferred, and said so

`trace_isnad` (the chain between two narrators) needs a transmission GRAPH the
corpus does not have. `lookup_narrator`'s description says "Tracing the isnād
CHAIN between two narrators is not available yet", and its zero-result note
repeats it. When a graph dataset (AR-Sanad 280K, SemanticHadith KG) is ingested
into our own Supabase — its own milestone, needs a migration + ingest — it lands
as `trace_isnad` on this same connector.

## Consequences

**Positive**
- Narrator questions are now a first-class, gated tool with its own Hub card —
  the corpus's 19.6k biographies + narration counts were reachable from no
  dedicated chat surface before (the exact gap ADR-0014 named for Tier D).
- Nothing to download, build, or run; no dependency on a third-party service.
- Reuses the `search_hadith` bridge and artifact code wholesale.

**Negative**
- `lookup_narrator` is only as good as the corpus's rijāl coverage and
  `planQuery`'s discipline detection — a query that doesn't read as رجال may not
  fire Tier D. Mitigated by `rijalQuery.ts` making every query explicitly رجال.
- No isnād-graph capability at all until a transmission dataset is ingested. The
  tool and its note are explicit about this so the model doesn't promise it.
- `rijal` and `hadith` connectors overlap (both can surface narrator info). The
  category-collapse in `classifyIntent` routes cleanly; documented here.

## Follow-ups

- `trace_isnad` + a `rijal_narrators` / `rijal_transmissions` schema from
  AR-Sanad 280K / SemanticHadith KG — a separate ingestion milestone (Lovable /
  Supabase migration + `INGEST_SHARED_SECRET` batch load).
- Web parity: `lookup_narrator` already routes through the same bridge as
  `search_hadith`, so it works on web once that bridge does.
