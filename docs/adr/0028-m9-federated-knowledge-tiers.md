# ADR 0028 — Federated Knowledge Tiers; Tier-2 Repositories Are Bibliographic-Only

**Status:** Accepted · **Date:** 2026-09-05 · **Milestone:** SPEC-M9

## Context

The goal: the agent consults the world's scholarly libraries without
downloading them, and never answers without a source. Assessed tier by tier
against what the repo already had.

- **Tier 1 — local gold standard.** Already built: `search_shamela` (native
  Lucene), and `query_tafseer` + `search_hadith` (M9 Phase 1). The one addition
  was tier precedence in `systemPrompt.ts` ("local sources first, and the
  preferred citation") and tool ordering in `toolScoping.ts`.
- **Tier 3 — whitelisted scholarly web.** Already `search_general` through the
  signed-in `research-query` channel. Its whitelist was widened in a separate
  reviewed change (see ADR-0022) — no new tool, and **no Firecrawl** (rejected
  again in M9 planning).
- **Tier 4 — the researcher's own library.** The ingest engine
  (`electron/db/ingest.ts`) and `search_corpus` already exist; only a bulk
  "point at a folder of PDFs" gesture is missing (a later slice).
- **Tier 2 — global repositories.** The one genuinely new outward capability.
  Verified: no reference to archive.org / OpenAlex anywhere in the repo.

## Decision — `search_repositories`

A read tool over **two fixed, named public endpoints**:

| Repository | Endpoint | Returns |
|---|---|---|
| Internet Archive | `archive.org/advancedsearch.php` | scanned editions — an `archive.org/details/<id>` link |
| OpenAlex | `api.openalex.org/works` | journal articles, theses, monographs — metadata + DOI |

Neither needs auth, so it runs **directly in the main process**
(`electron/agent/adapters/repositories.ts`), like the Tafsir MCP client — not
renderer-bridged. This is not open browsing: the URLs are built here from a
query and nothing else, which is why it does not reopen ADR-0019's rejection.

**waqfeya** and a **live OpenITI API** were dropped: waqfeya has no public API
(reaching it means scraping — the rejected path), and OpenITI is a
GitHub/Zenodo bulk corpus, not a query endpoint (and `openiti-index` is already
ingested — a separate data-quality task audited its discipline tagging; see
Consequences).

## Decision — bibliographic-only citations

Neither source gives verifiable full text: Archive.org returns a page image the
agent cannot read without OCR; OpenAlex returns metadata. So a repository hit is
a `RetrievedChunk` with `bibliographic: true` — it cites a **work** (author,
title, year, link). `insert_footnote` accepts it **only when no `claim` is
passed**; a `claim` alongside a bibliographic chunk is refused with a message
telling the agent to find the passage in Shamela or the corpus. The agent can
name the work; it can never assert what a page of it says.

## Decision — opt-in per project

Tier 2 is network-dependent in a local-first app, so it is its own connector
(`repositories`, `shared/agent/connectors.ts`) with `defaultOff: true` — the
scholar turns it on per project from the `+` hub. `isConnectorOn` / `setConnector`
gained the default-off case; `run.ts` hides the tool and `runPlaybook` skips its
steps when it is off (M9 Phase 1b machinery).

**Privacy:** OpenAlex's polite pool wants a contact in the query — the code
sends a generic `agent@easyeditor.app`, **never the signed-in scholar's
address**.

## Consequences

- `RetrievedChunk.bibliographic`; the citation-list artifact marks Tier-2
  entries `tier: 2`.
- `/thematic-paper` gained an optional `search_repositories` step (skipped
  unless the connector is on).
- **The `openiti-index` discipline-tagging task is closed (2026-09-04) as a
  documented negative.** Row-level facts from `scholarly_documents`: **4,780
  rows, 0 with `citation_ref->>'discipline'`, 0 with a `tags` key in
  `citation_ref`.** `openiti-index` is a *work-level catalogue index* — one
  transliterated metadata line per OpenITI work, from
  `scripts/openiti_metadata_to_csv.py` — not ingested prose: no volume/page, and
  the `_TAFSIR` / `_NAHW` genre markers exist only as loose text in the
  `content` blob, not as a structured field to backfill from. The rows are
  embedded only off the stub, so semantic search does not discriminate by topic.
  The tag cannot be "corrected" into a scoped citable source. `openiti-index`
  was **removed from `DISCIPLINE_DOMAINS`** (it was inert there and cost
  `match_count` slots); the `src/lib/research/sources.ts` note was downgraded
  from "unverified" to this concrete finding. A real full-text OpenITI ingest
  via `classical_to_csv.py` (domain `openiti`) stays out of scope — consistent
  with this ADR's rejection of OpenITI as a live capability. See ADR-0014's
  follow-ups for the full audit.
