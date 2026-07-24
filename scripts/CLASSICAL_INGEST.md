# Tier-2 Classical Corpus Ingestion

How to load classical books (Shamela / OpenITI) — fiqh, fatawa, tafsir, lughat,
rijal, nahw — into `scholarly_documents` so the citation engine can cite from
them. This is the Tier-2 half of the Master Plan's 4-tier search.

## The scope model

Quran/Hadith rows scope by `source_type` (`quran`/`hadith`) + collection/surah.
Tier-2 rows add a **discipline** dimension in `citation_ref->>'discipline'`:

| discipline | `source_type` | typical `domain` |
|------------|---------------|------------------|
| `fiqh`     | `classical`   | `shamela` / `openiti` |
| `fatwa`    | `fatwa`       | `shamela` / `openiti` / `islamqa-cache` |
| `tafsir`   | `tafsir`      | `qul-tafsir` / `shamela` / `openiti` |
| `lughat`   | `classical`   | `shamela` / `openiti` |
| `rijal`    | `classical`   | `shamela` / `openiti` |
| `nahw`     | `classical`   | `shamela` / `openiti` |

The discipline slugs are the single source of truth in
`supabase/functions/_shared/disciplines.ts` (`DISCIPLINE_SLUGS`) and are mirrored
in `scripts/classical_to_csv.py` (`VALID_DISCIPLINES`). Keep them in sync.

At query time, `queryPlanner.ts` sets `scope.disciplines`, and
`citationEngine.ts`'s `classicalChannel` searches those disciplines via the
`search_classical_scoped` RPC (migration `20260725200000_classical_scope.sql`).

## Input format

A **manifest** (JSON) lists the books; each book points at a **pages JSONL**
(one page/section per line). See `scripts/samples/` for a runnable example.

- Manifest book fields: `book_id`, `title`, `title_en?`, `author`,
  `death_year?`, `discipline`, `madhhab?`, `domain`, `source_url?`, `pages_file`.
- Page line fields: `text` (Arabic, required), `volume?`, `page?`, `chapter?`.
  - tafsir pages may add `surah`, `verse`, `mufassir`.
  - fatwa pages may add `fatwa_number`, `scholar`.

## Run the loader

```bash
python scripts/classical_to_csv.py \
  --manifest data/classical/manifest.json \
  --base-dir data/classical \
  --output   data/classical_normalized.csv
```

Smoke-test with the bundled sample:

```bash
python scripts/classical_to_csv.py \
  --manifest scripts/samples/classical.manifest.sample.json \
  --output   /tmp/classical.sample.csv
```

## Load + embed

```bash
# 1. Import (note the explicit column list incl. source_url + passage_key)
psql "$DATABASE_URL" -c "\COPY scholarly_documents \
  (domain, source_type, title, content, content_ar, citation_ref, language, \
   source_url, passage_key) \
  FROM 'data/classical_normalized.csv' CSV HEADER"

# 2. Verify per-discipline counts
psql "$DATABASE_URL" -c \
  "SELECT citation_ref->>'discipline' AS discipline, COUNT(*) \
   FROM scholarly_documents GROUP BY 1 ORDER BY 2 DESC;"

# 3. Backfill embeddings (enables the semantic side later)
#    via the backfill-embeddings edge function, in batches.
```

## ⚠️ Content-hash dedup gotcha (check every load)

`scholarly_documents` has a unique index `scholarly_documents_content_hash_uidx`
on `(domain, source_type, md5(content))` — it ignores `citation_ref`. If two
genuinely different pages share **byte-identical `content`** (a repeated chapter
heading, a short editorial phrase, a lexical stub), the import keeps only the
first and **silently drops the rest** as "duplicates" — no error, the duplicate
count just looks normal.

So whenever the load reports a nonzero `duplicates` count, do **not** assume it
was redundant. Group the CSV by exact `content`; any group with more than one
distinct `passage_key`/`citation_ref` is real rows that got dropped. Recovery
pattern (as used for the Urdu hadith/tanzil loads): append a zero-width space
(U+200B) to `content` for every occurrence after the first in a collision group
and re-insert only those — it changes `md5(content)` without changing anything
the user sees. See `scripts/patch_missing_urdu_hadith.py` /
`scripts/patch_missing_tanzil_urdu.py` for the reference implementation.

## Suggested ingestion order

Sequence by which prompts depend on each corpus (see the 14-prompt registry):
**fiqh → tafsir → fatawa → lughat → rijal → nahw.** As each discipline lands,
flip its prompts' `corpusReady` to `true` in
`src/lib/prompts/promptsRegistry.ts` so the "ذخیرہ زیرِ تعمیر / unverified"
badge clears for that discipline.

## Notes

- `content` holds the Arabic page text; `content_ar` holds the diacritic-
  normalized copy the lexical RPC searches (matching the SQL `normalize_arabic_text`).
- `passage_key` is namespaced (`classical:…` / `tafsir:…`) so it never collides
  with `quran:` / `hadith:` keys used for dedup and rerank.
- The semantic (pgvector) side of the classical channel is intentionally not
  wired yet: it waits on the embedding backfill AND on `match_scholarly_documents`
  returning `passage_key` (so its dedup key matches the lexical rows). Until
  then the classical channel is lexical-only — correct, just narrower recall.
