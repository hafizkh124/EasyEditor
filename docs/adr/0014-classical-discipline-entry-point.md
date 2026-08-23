# ADR 0014 — An Explicit Entry Point for Rijal / Tafsir / Lughat, and Fixing Why They Were Unreachable

**Status:** Accepted · **Date:** 2026-08-23 · **Related:** [ADR-0013](./0013-source-picker-and-collection-registry.md)

## Context

Corpus Atlas finding #4 (2026-08-20): "Rijal, tafsir, and lexicon have no
explicit entry point." The stated symptom was that these three domains only
surface through `classicalChannel`'s implicit discipline detection — a
keyword sniff inside the query text — with no menu item, toggle, or mode that
names them directly.

Investigating to build the fix turned up something worse than the stated
symptom: **the classical corpus was not reachable from the main chat at all,
implicitly or otherwise.** `classicalChannel` lives in
`_shared/citationEngine.ts` and is called by `findCitations()`, which is used
by Editor "insert reference" and the refine-text citations assist mode —
**not** by `islamic-search`, the function the Islamic-mode chat panel
actually calls. `islamic-search`'s five tiers (A/B/C/K/L) never once
referenced `scope.disciplines` or called `classicalChannel`. A scholar typing
"راوی کا حال" into the research chat got zero acknowledgment that a rijal
corpus existed, regardless of phrasing.

A second, independent problem sat underneath the first: even through
`findCitations`, rijal and tafsir would have returned nothing. `search_classical_scoped`
filters on `content_ar IS NOT NULL`, and both disciplines are ingested with
`content_ar` deliberately empty —
`islamicurdubooks-rijal` because short Arabic names collide in the dedup
index, `islamicurdubooks-tafsir` because its embedding falls back to
`content`. `classicalChannel` had no other retrieval path. This is the exact
same shape of bug ADR-0013 fixed for the twelve tohed-hadith-only books
(`content_ar`-only search guaranteeing zero rows for a real, populated
discipline) — discovered here independently before the parallel was obvious.

## Decision

**1. Give `classicalChannel` a semantic half.** It now runs
`search_classical_scoped` (lexical, content_ar) and a new query against
`match_scholarly_documents` (semantic, scoped to the requested disciplines'
domains via `disciplineDomains()`, then post-filtered on
`citation_ref.discipline` since the RPC's own filter is domain-grained, not
discipline-grained) in parallel, and de-dupes by `match_key`. This is what
actually makes rijal and tafsir findable, independent of any UI work.

**2. Add a Tier D to `islamic-search`** — `classicalChannel`, reused directly
(not reimplemented), gated two ways: implicitly, whenever the query planner
already detected a discipline from the question text (unchanged detection,
now finally connected to something); explicitly, whenever the user narrowed
the source picker to a `classical-*` pseudo-domain, checked against the raw
request field rather than the domain list defaulted to "everything" — so a
vaguely-phrased question can still force the discipline the user picked, and
an unrelated question doesn't pay for a wasted embedding call.

**3. Offer exactly three disciplines in the picker: رجال، تفسیر، لغت.**
`_shared/disciplines.ts` defines six (fiqh/fatwa/tafsir/lughat/rijal/nahw),
but fiqh/fatwa/nahw's only domains are `shamela` (never ingested — 0 rows)
and `openiti` (ingested, but as untagged general prose with no discipline
recorded). Offering a checkbox for either would return zero rows every time,
which ADR-0013 already declined to do for `shamela-index` on the same
grounds — extended here to keep both source-selection surfaces honest by the
same rule.

> **Correction (2026-08-23, same day):** decision 3 was wrong about fatwa, and
> `classical-fatwa` has since been added. See the "Correction" section at the
> end of this ADR.

## Rationale

- **Fix reachability before adding a control.** A toggle for a channel that
  returns nothing is worse than no toggle — it teaches the user the corpus
  doesn't exist. The `content_ar`-gap bug had to be fixed first.
- **Reuse the engine, don't fork it.** `classicalChannel` already encoded the
  right discipline-scoping logic for `findCitations`; exporting it and
  calling it from `islamic-search` keeps one implementation instead of two
  that could drift, matching how Tier L already reuses
  `personalVectorChannel`/`personalLexicalChannel` the same way.
- **Implicit detection stays primary, explicit selection is the escape
  hatch.** The Atlas's complaint was the *absence* of an explicit path, not
  that implicit detection was wrong — keyword sniffing is a reasonable
  default for "the question already says رجال"; the picker exists for
  the case where it doesn't.

## Consequences

**Positive**

- Rijal (19,616 rows) and tafsir (6,208 rows) are reachable from the chat for
  the first time, through either detection path.
- The `content_ar`-gap fix also helps every existing `findCitations` caller
  (Editor reference insert, refine-text citations) — they inherit the fix for
  free, no separate change needed there.
- An unrelated Quran/Hadith question pays no extra latency: Tier D only fires
  when a discipline is actually in play.

**Negative**

- Two more parallel branches (lexical + semantic) added to an already-large
  fan-out; the semantic half costs one embedding call whenever a discipline
  is in scope.
- `openiti`'s discipline coverage is unverified — if it later turns out to
  carry `citation_ref.discipline` tags after all, fiqh/fatwa/nahw could be
  added to the picker without further backend changes.

## Correction (2026-08-23, same day) — fatwa was wrongly excluded

Decision 3 above claimed fatwa had no ingested rows. **That was wrong, and the
error came from trusting a mapping instead of the corpus.** Investigating
Corpus Atlas finding #5 the same day turned up two bugs in
`DISCIPLINE_DOMAINS`:

1. **`urdufatwa` was missing from `fatwa` entirely.**
   `scripts/scrapers/ingest_fatwa.py` writes 22,775 rows there, tagged
   `citation_ref.discipline = "fatwa"` — the largest fatwa corpus in the
   project. Because the mapping never listed the domain, it never entered
   `filter_domains`, so no semantic query could reach it. Reading the mapping
   and concluding "fatwa has no rows" inverted cause and effect: the corpus
   was there, the mapping was broken.
2. **`openiti` is not a domain.** The corpus stores `openiti-index` (confirmed
   by `vector-search`'s `TIER_B_DOMAINS` and the Atlas domain census), so
   every discipline's `openiti` entry matched zero rows — including the ones
   this ADR had just shipped.

A separate finding, from a live probe of `backfill-embeddings` on the same
day: **the Atlas's "urdufatwa: 0 embedded" is stale.** `remaining_total` is 0
for every `source_type` and for the table as a whole, so the corpus is fully
embedded. Finding #5 needed no embedding backfill and no API quota at all —
only the two mapping fixes above. Both are now corrected, `classical-fatwa` is
in `TIER_D_DOMAINS` and the picker, and
`src/test/researchSources.test.ts` pins both facts so neither can regress.

The generalisable lesson, and the second time this exact shape has bitten this
project (see ADR-0013's slug mismatches): **an empty-looking corpus is more
often a stale mapping than an empty corpus.** Check the data before concluding
a source is absent.

## Follow-ups

- Confirm live whether `openiti-index` rows carry any `citation_ref.discipline`
  value at all (a `GROUP BY citation_ref->>'discipline'` on that domain would
  settle it) before deciding whether fiqh/nahw are worth ingesting via
  `scripts/classical_to_csv.py`. They remain the only two disciplines still
  excluded from the picker.
- **Cross-tier duplication is unaddressed.** `islamic-search` merges every
  tier's rows into `allResults` with no dedup (only topic anchors are deduped,
  on a quran/hadith-shaped key that is empty for fatwa and classical rows). A
  fatwa ruling can now surface from both Tier K (lexical) and Tier D
  (semantic) in one answer. This predates Tier D — Tier B and Tier K can
  already both return the same hadith — and fixing it properly needs a stable
  identity on `IslamicResult`, which it does not currently carry. Worth its own
  change rather than a patch here.
- `islamicurdubooks-misc` (66 rows, hadith-terminology/duas) tags
  `discipline: "hadith_term"` / `"dua"` — neither is in `DISCIPLINE_SLUGS`, so
  those rows are unreachable by any discipline-scoped path. Out of scope here;
  the Atlas already flagged this domain as a "browse, not search" candidate
  (finding, item 6).
