# ADR 0054 — Turath.io classical library connector, two-tier cache, and fallback routing

**Status:** Accepted (revised after review, 2026-09-20) · **Date:** 2026-09-20 · **Milestone:** Turath Integration · **Extends:** [ADR-0007](./0007-shamela-native-read.md), [ADR-0014](./0014-classical-discipline-entry-point.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md), [ADR-0044](./0044-cloud-shamela-connector.md)

## Context

Eight scholarly prompts (`study_masala`, `compare_madhahib`, `tafsir_aya_muqaran`, `nazila_muasira`, `takhrij_fatwa`, `lughat_w_irab`, `tarjama_rawi`, `seerat_alam`) are held at `corpusReady: false` in `src/lib/prompts/promptsRegistry.ts` because the classical corpora (fiqh, lughat, nahw, seerah…) are not ingested. Local Shamela (ADR-0007) needs a multi-GB install and a JRE; cloud Shamela (ADR-0044) needs OAuth and quotas.

**Turath.io** indexes ~8,500 classical works. It has **no official or documented API**: `api.turath.io` is the endpoint the site's own client uses, known through a community SDK (`turath-sdk`), needs no credentials, and carries no published terms or rate limits. We depend on it anyway (kill-switch, throttle and cache below), and this ADR records the contract **as verified live on 2026-09-20 (`ver=3`)**:

| Endpoint | Success | Not found |
|---|---|---|
| `GET /search?q=&ver=3` | `200 { count, data: [ { book_id, cat_id, author_id, meta, snip, text } ] }` — note the **`data` envelope** | `200 { count: 0, data: [] }` |
| `GET /page?book_id=&pg=&ver=3` | `200 { meta, text }` — `meta` is a **JSON string**, and has **no `book_id`** | out-of-range page: `200 {}` |
| `GET /book?id=&ver=3` | `200 { meta: { id, name, author_id, cat_id, … } }` — `meta` is an object; **no author name** | `404 {}` |
| `GET /author?id=&ver=3` | `200 { id, name, biography, death }` — `death` is a hijri year in Arabic-Indic digits (`"١٤٣٨"`) | unknown id: `200 {}` |
| anything else, including `/page/<id>/<pg>` and `/book/<id>` | — | `404 {}` |

Search-hit `meta` is likewise a JSON string: `{ headings, page_id, page, vol, book_name, author_name }`, with **`vol` a string**. `text` and `snip` contain markup (`<em>` highlights, `<span data-type="title">`, `<s>`, `<hr>`, and entities such as `&quot;`).

### Two coordinates, easily confused

- **`page`** is the *printed* page number. It **restarts in every volume**. It is what a scholar cites (`ج2، ص129`).
- **`page_id`** is a sequential index unique within the book. It is what `/page?pg=` takes and what the reader's `?page=` takes. Verified in the reader: `?page=13` of book 127708 opens printed page ١/١٦, and the API says `page_id 10 ↔ printed 13` in that book (offset 3).

Mixing them up either fetches the wrong page or links to it.

## Decision

### 1. Three-tier routing behind `shamelaRouter.ts`

The agent keeps one tool triad (`search_shamela`, `read_shamela_page`, `find_shamela_book`). `electron/agent/adapters/shamelaRouter.ts` resolves **local → cloud → turath**:

1. Local Shamela, if enabled. A success — *including zero hits* — is authoritative.
2. Cloud Shamela, only if local is off or errored.
3. Turath, only if cloud is off or errored.

For `read_shamela_page` the id prefix picks the transport (`shamela:`, `shamela-cloud:`, `turath:`). `routeShamelaFindBook` used to return `none` on a cloud error without trying anything else; it now cascades.

**Addressing.** A Turath result's `pageNumber` — and therefore the id `turath:<book>:<pageNumber>` handed to the model — is the **`page_id`**, so it round-trips through `read_shamela_page`. The printed volume/page travels separately as `volume` / `printedPage` / `pageLabel`, and `dispatch.ts` uses `pageLabel` for the citation reference.

### 2. Connector registry

`turath` is registered in `shared/agent/connectors.ts` (`category: 'islamic-sciences'`, `healthKind: 'http'` with a probe in `connectorsHandlers.ts`, `tools: []`, on by default like Dorar/Ganjoor). It is added to `MULTI_OWNER_TOOLS` for the three shamela tools, `CONNECTOR_PROVENANCE_LABEL` and `connectorsUsed`. Its description states that the query text is sent to `api.turath.io`.

### 3. Normalisation (`supabase/functions/_shared/turath.ts`, shared by desktop and cloud)

- `extractTurathHits` reads the `{count, data}` envelope. (An earlier version looked only for a bare array or `.results`, found nothing in the real response, and Tier T returned zero rows for every query.)
- `parseTurathMeta` parses the JSON-string `meta`; `numOrUndef` reads `vol`/`page` including Arabic-Indic digits, and leaves a non-numeric volume `undefined` rather than guessing `1`.
- `stripTurathHtml` removes tags **with no replacement** (a highlight can sit mid-word, `<em>ال</em>ربا`; a space would split the token), turns `<hr>`/`<br>` into a line break, keeps line structure (numbered lists), and decodes the common entities.
- `turathReaderUrl(bookId, pageId?)` → `https://app.turath.io/book/<id>?page=<page_id>`. The host matters: `turath.io/book/…` **302-redirects to the app root and drops the book and page**. Without a `page_id` it links the book alone rather than a guessed page.

### 4. Cross-tier identity (`resultIdentity.ts`)

A classical passage is identified by **book + volume + page**, in the same shape the corpus already uses for `passage_key` (`classical:<book>:v<vol>:p<page>`, see `scripts/classical_to_csv.py`). Volume is mandatory because printed pages restart per volume: keyed on book+page alone, page 12 of volume 1 and of volume 9 collapsed into one and the later passage was dropped. A row with book and page but **no volume gets no identity** (`null` → kept): keeping a possible duplicate is the safe side. Note the local corpus mostly uses slug book ids (`hidaya`), so Tier D and Tier T collapse only where both carry the same numeric id.

### 5. Two-tier cache

- **Desktop:** in-memory LRU (500 entries) + `userData/turath-cache.json` (debounced atomic write). The file carries a **format version** (`2`); an older file is ignored, because v1 was written by the buggy parser and holds cached-empty search results that would otherwise be served for another 24 h.
- **Cloud:** in-memory map + the existing `api_response_cache` table; keys are prefixed `turath:v2:` so rows from an older row shape are never served.
- **TTLs:** pages 7 days, searches 24 h, authors 7 days. **Errors are never cached.**

### 6. Resilience

Max 2 concurrent requests, 12 s timeout (`AbortController`), one retry on 429/5xx honouring `Retry-After`. Cloud: `TURATH_ENABLED` env kill-switch, 6 s timeout per call. A failed Turath call degrades to "no rows", never a thrown error in the agent loop.

### 7. Tier T (cloud) trigger

Tier T is a **new tier**, not part of Tier D (Tier D is the local classical corpus). It runs when the user picks the `turath` domain, or when the query planner detects one of `TURATH_DISCIPLINES` = `fiqh`, `fatwa`, `lughat`, `nahw` (`shouldQueryTurath`). **`tafsir` and `rijal` are deliberately excluded:** the local corpus already holds real data for them (6,208 tafsir rows, 19,616 rijal biographies) and a live probe showed Turath is noisy there (“تفسير آية الكرسي” → manuscript catalogues; “ترجمة سفيان الثوري” → Tuhfat al-Ashraf entries that merely cite his name). Rank fusion cannot tell noise from a good hit, so those rows would displace good local ones. A test cross-checks the list against `DISCIPLINE_SLUGS` (an earlier version listed `seerah`, which the planner cannot emit, so that branch was dead).

## Consequences

**Positive.** Classical fiqh/fatwa/lughat retrieval on desktop and web with no install or credentials; repeated queries served from cache; volume-correct deduplication; working deep links.

**Negative / risks.**
- **Unofficial API.** It can change, throttle or vanish. Mitigations: kill-switch, throttle, caching, silent degradation, an explicit source label in the UI.
- **Search is a raw full-text match**, so recall is broad and relevance uneven (see §7).
- Search hits carry the author *name* but not the death year; `findTurathBook` by text therefore reports `deathYear: null` (by id it resolves it through `/author`).
- **`corpusReady` is not flipped by this ADR.** The eight prompts stay `false` until each is verified on the deployed app; findings and the procedure are in `supabase/deploy/README.md` ("Classical prompts: evidence gate"). `seerat_alam` has no route to Turath until the planner gains a seerah discipline or the prompt passes `selectedDomains: ["turath"]`.

## Lessons recorded

The first implementation passed its own tests while being wrong against the live API in four ways (404 URLs, unread envelope, wrong page address, wrong link host), because its `fetch` mock returned a canned body for **any** URL and its fixtures were hand-written. `src/test/helpers/turathApiFake.ts` now mirrors the real API's paths, parameter names and status codes (404 `{}` for anything else) and `src/test/fixtures/turath/*` are trimmed copies of real responses.
