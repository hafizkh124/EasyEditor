# ADR 0022 — Agent Reach into Local Subsystems (Tafsir, Hadith); the Web Path Stays `search_general`

**Status:** Accepted · **Date:** 2026-09-04 · **Milestone:** SPEC-M9

## Context

EasyEditor already has a Tafsir MCP client (`electron/tafsir/mcpClient.ts` — remote
tafsir.net or a local `uvx tafsir-mcp`, per-tool allowlist) and a grounded Islamic
research channel (`islamic-search` edge function, "17 hadith collections loaded",
page-precise `sources_ready` citations). Neither was reachable from the agent loop.
M9's Q&A cluster (use cases 5, 8) and the citation clusters need both.

The M9 proposal also listed a `search_web_scholarly` tool (Firecrawl, 12 portals).

## Decision — two new read tools, bridged to what exists

**`query_tafseer`** `{ reference, mode, sources?, query? }`,
`mode ∈ {ayah, tafsir, nuzool, word, search}`.
`electron/agent/adapters/tafsir.ts` connects the MCP client on demand (remote
first; local only if its DB is present), maps `mode` to an allowlisted tool
(`fetch_ayah` / `fetch_tafsir` / `fetch_nuzool_reason` / `analyze_word` /
`search_in_tafsir`), and returns a **citable** `RetrievedChunk`
(`id: tafsir:<mode>:<source>:<surah>:<ayah>`, reference `تفسير (…) — <sūrah>: <āyah>
(tafsir.net)`). Sūrah:āyah parsing (numeric, Arabic-Indic digits, names) is
`shared/quran/surahNames.ts`. Unreachable sources → a clean error, never a throw.

**`search_hadith`** `{ query, collection?, limit? }` — renderer-bridged.
`electron/agent/researchBridge.ts` generalises M8's `generalSearch.ts` into
`requestResearch(runId, query, sender, mode)` with `mode ∈ {general, islamic}`;
`AgentPanel` runs `streamIslamicQuery` and returns its `sources_ready` citations.
The dispatcher maps each citation through `formatScholarlyRef` (collection + number
+ grade + rāwī) into a **citable** chunk. A citation with nothing source-precise is
dropped, not guessed.

Both feed the same `RetrievalLedger`, so `insert_footnote` immediately gains two new
grounded source types. `generalSearch.ts` stays as the `search_general` entry point
(a thin wrapper over `requestResearch(..., 'general')`); its results remain
**non-citable** (ADR-0019).

## Decision — no `search_web_scholarly`, no Firecrawl

ADR-0019 item 4 rejected an open web tool; the user reaffirmed this in the M9
planning session (Firecrawl out). The web path stays `search_general` through the
signed-in `research-query` channel, whose provenance tagging Trust UI depends on.
Widening its reach means adding domains to `src/lib/research/scrapingWhitelist.ts`
**and its two Supabase mirrors** (`research-query`, `domain-scrape`) — a separate,
reviewed change against the deployed functions, not part of the agent work.

### The whitelist widening — done (2026-09-04)

Five hosts added to `SCRAPING_WHITELIST` in both mirrors, plus one that fixed a
pre-existing drift:

| Host | Body |
|---|---|
| `iifa-aifi.org` | مجمع الفقه الإسلامي الدولي (OIC) |
| `dar-alifta.org` | دار الإفتاء المصرية |
| `aliftaa.jo` | دائرة الإفتاء الأردنية |
| `binbaz.org.sa` | فتاوى الشيخ ابن باز |
| `banuri.edu.pk` | جامعہ بنوری ٹاؤن، دار الافتاء |
| `darulifta-deoband.com` | دار الافتاء دیوبند — **drift fix**, see below |

Each candidate was fetched with the pipeline's own User-Agent
(`Mozilla/5.0 (compatible; ResearchBot/1.0)`) and kept only when it returned
readable article HTML. **Three were rejected on evidence**, not taste:
`alifta.gov.sa` (200, but a JS-rendered shell — ~130 characters of text),
`islamway.net` (200 with an empty body to every User-Agent tried), and
`cii.gov.pk` (no A/AAAA record; the zone is delegated but offline).

**Drift found:** `darulifta-deoband.com` was registered in `domain-scrape`'s
`DOMAINS` but absent from both whitelists — which that file's own comment
forbids — so anything it returned for that host could never be fetched or cited
upstream. `researchSources.test.ts` now enforces both invariants: the two
whitelist array literals must be byte-identical, and `DOMAINS ⊆ whitelist`.

**`domain-scrape`'s `DOMAINS` was deliberately left unchanged.** The two paths
are independent: `isWhitelistedUrl` gates research-query's *direct* fetch of
user-supplied source URLs, while domain-scrape's results bypass that check and
are injected as context — so widening the whitelist alone achieves the goal.
Registering a host in `DOMAINS` instead makes Firecrawl fan out to it on every
Islamic-flavoured General query, which is five more paid calls against a 15 s
budget already shared by twelve hosts. The reasoning is recorded in that file.

## Consequences

- `AgentSession` gains `researchSearch`; `agentHandlers.ts` wires it and passes
  `citations` back through the `generalSearchResult` action.
- `toolScoping.ts` (F2): a fatwā/tafsīr/hadith ask now exposes `query_tafseer` /
  `search_hadith`; `CITABLE_SEARCH_TOOLS` grows to four (citation-closure still
  holds).
- `/shariah-fatwa` playbook added, with `guidance` (the 5-stage istiftāʾ method).
  In Ask mode a read-only playbook run ends with one synthesis call so the scholar
  gets a sourced answer, not a step tally.
