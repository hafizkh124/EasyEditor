# ADR 0043 — Arabic → Urdu lexicon: corpus + al-Maany, no synthesised glosses

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub (Phase 6) · **Extends:** [ADR-0014](./0014-classical-discipline-entry-point.md), [ADR-0016](./0016-m8-agentic-loop-supersedes-fixed-tasks.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md)

## Context

Phase 6 of the plan was an offline SQLite index of *Miṣbāḥ al-Lughāt* (Balyāwī)
and *al-Qāmūs al-Wāḥid* — Arabic → Urdu printed dictionaries. **The data does not
exist:** those two works are online only as scanned PDFs, with no structured
full text and no root→page index of their editions. al-Maany has an Arabic-Urdu
dictionary but blocks automated backend requests (Cloudflare).

A proposed alternative was a "3-tier hybrid": (1) a root→page almanac, (2) the
**agent synthesising the morphology and gloss**, then (3) stamping a
`[مصباح اللغات، ص 345]` citation on it plus an al-Maany link.

**Tier 2 is rejected.** An LLM-generated gloss attributed to a printed page the
system never read is a **fabricated citation** — the precise failure the
retrieval ledger, `insert_footnote`'s "reference text is NEVER something you
write", and "never produce unsourced prose to fill the gap" (ADR-0016 / 0019 /
0027) exist to prevent. A scholar quoting `[مصباح اللغات، ص 345]` from our
output would be publishing a misattribution.

## Decision

### `lookup_lexicon` reuses the corpus's verified lexical material

Like `lookup_narrator` reuses `classical-rijal` (ADR-0041): `shared/agent/
lexiconQuery.ts` (pure) shapes `{ word }` into an Arabic لغت query that
`islamic-search`'s Tier D auto-detects as the `lughat` discipline (marker
`/لغت|لغوی|معجم|القاموس|مفردات|lexicon/`), reaching the corpus's ingested
Arabic → Urdu lexical works (لغتِ قرآن, `islamicurdubooks-lexicon`). It routes
through the **existing `search_hadith` renderer bridge** — no MCP, no IPC, no
download. The returned citations are real, cited to their work.

### An al-Maany link on every result — to verify, not to cite

Each result carries `almaanyUrl(word)` = `almaany.com/ur/dict/ar-ur/<word>/` and
one citation-artifact entry for it, clearly labelled *«رابط خارجي للتحقق»*. It is
**not added to the ledger**, so `insert_footnote` cannot cite it — it is a place
the scholar opens to check, exactly as the plan's Tier 3 intended. When the
corpus has nothing, the tool says so and still gives the link.

### Printed-page citations — deferred, honest slot

`resources/lexicon/root-page-map.json` (electron-builder `extraResources`) maps
a root / headword to its Miṣbāḥ / al-Qāmūs page. It **ships empty**.
`printedPageCitation(word)` returns null until a real index is supplied; then
`lookup_lexicon` appends a genuine `[مصباح اللغات، ص N]` citation. Same pattern
as the deferred Urdu verse corpus (ADR-0042) and the deferred `trace_isnad`
graph (ADR-0041): tool, connector, gating and tests are all wired, so populating
it is a file drop.

### Connector and gating

`lexicon` connector: `category: 'quranic-lexicon'` (alongside Bahouth),
`healthKind: 'bridged'`, **ships enabled**. `toolScoping` gains a lexicon
`DomainRule` **above the tafsir rule** (keywords لغوی معنیٰ / لفظ کا مطلب / معجم
/ مفردات / المعاني …) with `connector: 'lexicon'` — both share the
`quranic-lexicon` category, so `classifyIntent` collapses "لفظ کا لغوی معنیٰ" to
`lexicon` (most specific), not "lexicon + tafsir = ambiguous". `lookup_lexicon`
joins `CITABLE_SEARCH_TOOLS`.

## Consequences

**Positive**
- Ships now, 100 % functional, with citation integrity intact: every reference
  is either a real corpus work or an explicit "go verify" link.
- The Miṣbāḥ / al-Qāmūs page data has a clean drop-in slot for when it exists.
- No new infrastructure — reuses the Tier-D bridge and artifact code.

**Negative**
- Coverage is the corpus's `lughat` discipline coverage (`islamicurdubooks-lexicon`
  + `shamela`), not the two named printed dictionaries. The tool description and
  the connector label say so.
- The al-Maany link is a manual step for the scholar — by design, since al-Maany
  cannot be read programmatically and we will not guess what it says.
- Another tool routes through Tier D (`lookup_narrator`, `lookup_lexicon`,
  `search_hadith`); `planQuery`'s discipline detection is the shared dependency.

## Follow-ups

- A real Miṣbāḥ al-Lughāt / al-Qāmūs al-Wāḥid root→page index → drop into
  `resources/lexicon/root-page-map.json` (format in its README).
- If the user obtains a distributable full-text of either dictionary, a proper
  SQLite FTS index becomes the original Phase 6 — this ADR does not preclude it.
