# ADR 0013 — An Opt-In Source Picker, and Book Scoping via a Canonical Registry

**Status:** Accepted · **Date:** 2026-08-23 · **Supersedes in part:** [ADR-0002](./0002-three-mode-research.md)

## Context

The Corpus Atlas survey (2026-08-20, live query against `scholarly_documents`
plus a full read of the four retrieval paths) found two gaps between what the
corpus contains and what a user can reach.

**1. No way to say which sources to trust.** Islamic mode fans out over 15
domains that differ in kind: a local, verified corpus of ~430,000 rows; three
third-party APIs; and eleven websites scraped live at query time. The backend
has honoured a `selectedDomains` filter end to end for months, and both label
maps (`src/lib/citations/domains.ts`, `src/lib/research/bibliography.ts`) are
fully built out — but the chat hook never sent the field, so every query
searched everything and no UI surface existed to say otherwise.

ADR-0002 removed the original domain checklist deliberately: scholars "want all
domains queried in parallel and summarized. The checklist was friction without
value." That reasoning was sound for a five-domain, all-Quran/Hadith source set.
It reads differently now that a citation may come from a page scraped out of
someone's website in the same list as one from the verified corpus, and a
scholar writing a تخریج has no way to exclude the former.

**2. The book-scoping allowlist was stale and partly wrong.**
`queryPlanner.ts` let the LLM choose a scope only from a hardcoded array of 17
slugs copied out of `scripts/hadith_json_to_csv.py`. Two failures followed, both
silent:

- Every book ingested after `hadith-json` — the 17 IslamicUrduBooks titles, the
  5 easyquran-hadith titles, the 14 tohed-hadith titles — was un-nameable. "صرف
  مستدرک حاکم میں" was dropped and the query widened back to the whole corpus.
- Three of the 17 slugs did not match the strings actually stored in
  `citation_ref->>'collection'`. Older ingestion pipelines never agreed on a
  naming convention, and a later de-duplication kept whichever copy was larger.
  Confirmed against a live pull of 33,080 rows
  (`data/citation_backup_20260823_141244.csv`): the surviving strings are
  `mishkat_almasabih`, `aladab_almufrad`, `Muwatta Malik` and
  `shamail_muhammadiyah`, while the allowlist offered `mishkat`, `adab` and
  `malik`. Scoping to مشکاۃ matched zero of its 3,231 rows.

## Decision

**1. Ship the picker as an opt-in narrowing, not a required step.** A single
control beside the mode switcher, Islamic mode only. The default — and the
state after "ری سیٹ" — is an empty selection, which means *every* source, so
nobody has to open it to ask a question. ADR-0002's insight is kept as the
default behaviour; what changes is that a scholar who wants a narrower answer
can now express it.

The empty-means-everything convention is load-bearing: `islamic-search` reads
`selectedDomains ?? ALL_DOMAINS`, so an empty array searches **nothing**.
`toSelectedDomains()` in `src/lib/research/sources.ts` is the only place allowed
to translate a UI selection into the wire value, and it maps both "none picked"
and "all picked" to `undefined`.

`shamela-index` is offered by the backend but omitted from the picker: Shamela
has never been ingested, and `vector-search`'s `PSEUDO_DOMAIN_EXPANSION` maps it
to nothing on purpose. A checkbox that can only return zero results
misrepresents the corpus more than its absence does.

**2. Replace the slug allowlist with a canonical book registry.**
`supabase/functions/_shared/collections.ts` holds one entry per book: a
canonical `id` (the only value the planner may emit), Urdu and Arabic titles,
**every** `collection` string the book is known to be stored under, the domains
it lives in, and whether Arabic matn exists for it at all. The planner picks
ids; the retrieval layer expands an id to its full slug set immediately before
SQL.

Listing several candidate strings costs nothing — `p_collections` is an array,
so a variant that does not exist matches no rows while the one that does matches
all of them. That makes the mapping *robust to naming drift* rather than
silently wrong whenever a guess is off, which is the exact failure mode being
replaced.

The registry also carries `arabicMatn: false` for the twelve tohed-hadith-only
books. `search_documents_scoped` filters on `content_ar IS NOT NULL`, so an
Arabic-only search scoped to those books cannot return anything; callers now
route them to `search_documents_smart`, which matches the Urdu translation, and
enforce the book scope in TypeScript.

## Rationale

- **Default-open beats default-narrow.** The friction ADR-0002 objected to was
  being *required* to choose. A collapsed control with an honest "تمام مآخذ"
  label imposes none of it.
- **Tiers are the right grouping.** The picker groups sources the way the
  backend actually retrieves them (local corpus / API / live web) instead of
  inventing a taxonomy, because that distinction is precisely the one a scholar
  deciding what to cite cares about.
- **Ids over slugs.** A canonical id is a stable contract with the LLM; a
  storage slug is an implementation detail of whichever pipeline did the
  ingestion. Keeping them separate means a future re-ingestion changes one array
  in one file instead of breaking scope silently.
- **Name matching by whole tokens.** The old fallback tested `/مسلم|muslim/` as
  a substring, so any question about مسلمان scoped the search to صحیح مسلم.
  Matching requires every token of a name phrase to be present, and when two
  books' hits nest ("مختصر صحیح بخاری" matches both bukhari and
  mukhtasar-bukhari) the more specific one wins.

## Consequences

**Positive**

- Book scoping works for all 48 registered books instead of 17, and works at all
  for the four whose stored strings never matched their slugs.
- A scope of Urdu-only books no longer spends the scoped RPC's 8s statement
  timeout proving that a `content_ar` search finds nothing.
- The planner prompt is generated from the registry, so the model's book list
  can never drift from the allowlist its output is validated against.
- The picker gives the existing `selectedDomains` backend a reason to exist, and
  the session record now stores what was actually searched instead of a
  hardcoded `[]`.

**Negative**

- The planner's system prompt grew by ~48 lines. It is cached per query for 24h
  in `api_response_cache`, so the cost lands once per distinct question.
- The registry is only as correct as the evidence behind it. Eleven collection
  strings are confirmed against a live pull; the rest come from the ingestion
  scripts and `scripts/iub/registry.py`'s live-discovered mappings.
  `scripts/verify_collection_slugs.py` re-checks every slug against the
  database and reports any that match zero rows — it needs the service-role key
  and is not part of CI.

## Follow-ups

- Run `verify_collection_slugs.py` against production and prune or correct any
  slug it reports as dead.
- The Atlas's remaining findings are untouched by this ADR: no explicit entry
  point for rijal/tafsir/lexicon, tafsir reachable only semantically, urdufatwa
  not embedded, and no browse surface for the three deliberately unsearchable
  domains.
