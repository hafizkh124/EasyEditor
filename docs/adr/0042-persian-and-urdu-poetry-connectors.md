# ADR 0042 — Persian poetry (Ganjoor) and Urdu prosody connectors

**Status:** Accepted · **Date:** 2026-09-09 · **Milestone:** Connectors Hub (Phase 7) · **Extends:** [ADR-0028](./0028-m9-federated-knowledge-tiers.md), [ADR-0037](./0037-connectors-hub-and-curated-registry.md)

## Context

Phase 7 of the plan: Persian literature (Rūmī / Saʿdī / Ḥāfiẓ / Iqbāl's Persian)
via Ganjoor, and an Urdu literature module — metre scanning (تقطیع) plus the
Iqbāl / Ghālib corpora.

## Decision

### Ganjoor — a direct public REST call

`api.ganjoor.net/api/ganjoor/poems/search?term=…&pageSize=6` is a fixed, named,
no-auth API. `adapters/ganjoor.ts` calls it **directly in the main process**
(the `adapters/repositories.ts` / ADR-0028 pattern: the URL is built from a
search phrase and nothing else). `shared/research/ganjoor.ts` (pure) normalises
the poem array into citable chunks — poet + work + ordered verses + a
`ganjoor.net` link (`id: ganjoor:<poemId>`). An optional `poet` argument is
resolved to a poet id via `/api/ganjoor/poets` (best-effort). Never throws;
degrades to `{ chunks: [], error | note }`. `search_persian_poetry` joins
`CITABLE_SEARCH_TOOLS`. Connector `ganjoor`: `category: 'persian-adab'`,
`healthKind: 'http'`, **ships disabled** (needs the network).

This also covers Iqbāl's *Persian* dīwāns — the licence-clean way to reach them.

### Urdu prosody — pure compute + a deferred corpus

**`scan_urdu_prosody`** — `shared/prosody/scan.ts`, a pure rule-based taqṭīʿ
engine. It works from the written form, which omits short vowels, so it is a
**heuristic**: consonant + long-vowel letter → long syllable; a word-final
consonant closes the previous one; a lone consonant → short with an assumed
helping vowel. It matches the weight sequence against ~7 common buḥūr (final
foot tolerated). A clean match → `confidence: 'high'` + a named baḥr; otherwise
`bahr: null`, `confidence: 'low'`. **Every result carries a fixed note — "machine
reading, verify … the baḥr is a best guess, not a fact"** — and the tool
description forbids citing a baḥr as fact. Not a citable/ledger tool; it emits a
`table` artifact.

**`lookup_urdu_verse`** — reads `resources/prosody/urdu-verses.json`, bundled via
electron-builder `extraResources`. It **ships empty**, deliberately:

- **Ghālib** (d. 1869) is public domain everywhere, but the good open datasets
  are Rekhta scrapes of uncertain provenance — a scholarly tool wants a verified
  text, added on purpose.
- **Iqbāl's Urdu** work carries special, effectively perpetual protection under
  Pakistani copyright law — it is not bundled without a clear licence. (His
  Persian work is reached through Ganjoor.)

Until a corpus file is added the tool returns a clear "no corpus bundled yet"
note; scanning still works. This mirrors the Phase 6 lexicon deferral: the tool,
the connector, the gating and the tests are all wired, so populating it is just
dropping a file into `resources/prosody/` and rebuilding. Connector
`urdu-prosody`: `category: 'urdu-adab'`, `healthKind: 'compute'` (always green),
**ships enabled** (the scanner needs nothing). Only `lookup_urdu_verse` is
citable.

### Gating

`toolScoping` gains two `DomainRule`s at the end of the table:
`connector: 'ganjoor'` (فارسی شعر / رومی / حافظ / masnavi / ganjoor …) and
`connector: 'urdu-prosody'` (تقطیع / بحر / عروض / وزن / مصرع / prosody / scansion
…). A Persian ask gates to Ganjoor; a metre ask gates to the prosody connector.

## Consequences

**Positive**
- Persian poetry is reachable and citable with verse-level links, zero
  infrastructure.
- Metre scanning ships fully — the user's core Urdu ask — with no data
  dependency and honest "heuristic, verify" framing throughout.
- The Urdu verse corpus is a drop-in file away; no code change to populate it.

**Negative**
- The Ganjoor API shape is undocumented here (verified live 2026-09-09:
  `/poems/search` returns an array with `category.poet` / `category.cat` /
  `verses`). If it changes, the defensive normaliser yields `{ chunks: [] }`
  rather than crashing.
- The taqṭīʿ engine is genuinely approximate on irregular lines — it will often
  return `bahr: null / low`. That is the correct behaviour for a heuristic, but
  it means the tool is more useful as a "check my scansion" aid than an
  authority.
- No bundled Urdu verse corpus at launch (licensing / provenance). Documented in
  `resources/prosody/README.md`.

## Follow-ups

- A verified Ghālib text (Nuskha-e-Hamīdiya) as the first bundled corpus, if the
  user provides one they can distribute.
- A stronger syllabifier (dictionary-backed vowelisation) if metre accuracy
  proves important in use.
