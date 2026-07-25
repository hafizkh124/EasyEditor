# Deployment — 2026-07-25 (Search & Extract, Translation + Book Workspaces)

Everything in this folder is prepared so it can be run from the Lovable /
Supabase dashboard. Nothing here has been applied to the live project yet.

Do the steps **in this order**. Step 1 is safe to repeat; step 2 must happen
after the code is pushed.

---

## Step 1 — Run the SQL bundle

Open **Supabase dashboard → SQL Editor**, paste the whole of
[`2026-07-25_consolidated_deploy.sql`](./2026-07-25_consolidated_deploy.sql),
and run it.

It applies the end state of all six 2026-07-25 migrations in one transaction:

| Migration | What it adds |
|---|---|
| `20260725000000_passage_translations` | `passage_key` on `scholarly_documents`, `translators`, `passage_translations`, `get_passage_translations` RPC |
| `20260725100000_fix_translators_alquran` | Translator registry seeded with verified alquran.cloud edition ids |
| `20260725200000_classical_scope` | Tier-2 discipline index + `search_classical_scoped` RPC |
| `20260725300000_hadith_translators` | `hadith.ar` / `hadith.ur` / `hadith.en` registry rows |
| `20260725400000_translation_and_book_workspaces` | `translation_projects/chunks`, `book_projects/chapters/sections` + RLS |
| `20260725500000_update_translator_defaults` | Default translator ordering; Jawadi off by default |

**Use the bundle rather than running the six files individually.** Two reasons:

1. `CREATE POLICY` has no `IF NOT EXISTS` in Postgres, so re-running any of
   those migrations after a partial failure aborts with *"policy already
   exists"*. The bundle drops-then-creates every policy, so it can be re-run
   safely as many times as needed.
2. `20260725100000` starts with `DELETE FROM public.translators`. Run out of
   order — or re-run later — it also wipes the hadith translators from
   `20260725300000` and silently breaks hadith extraction in `/extract`. The
   bundle upserts instead of deleting.

The migration files stay in `supabase/migrations/` as the historical record;
the bundle is only a safe way to apply them by hand.

### Verify
The bundle ends with five commented verification queries — uncomment and run
them after it commits. In particular:

```sql
SELECT slug, language, corpus_type, is_enabled, sort_order
  FROM public.translators ORDER BY corpus_type, sort_order;
```
Expect **14 rows**: 11 Quran (with `ur.jawadi` disabled) + 3 hadith.

---

## Step 2 — Push, then redeploy edge functions

Pushing to `main` gets Lovable to rebuild the **frontend**, but it does **not**
redeploy edge functions. After the push, use Lovable's *redeploy edge functions*
action.

New / changed functions in this batch:

| Function | Status | Notes |
|---|---|---|
| `extract-translations` | **new** | Quran (alquran.cloud) + Hadith (HadithAPI) per-passage translations, cached into `passage_translations`. Registered `verify_jwt = false` (does its own bearer check). |
| `web-search` | **new** | Tier-4 open web via Tavily. Registered `verify_jwt = false`. |
| `_shared/citationEngine.ts` | changed | classical channel, takhrij, tafsir ordering, kifayat gate |
| `_shared/arabicRoot.ts` | **new** | tashkeel/hamza normalization, light root, boolean query parsing |
| `_shared/citationFormat.ts` | **new** | three citation styles |
| `_shared/disciplines.ts` | new (earlier) | Tier-2 discipline registry |
| `translate-page` | changed | accepts `genreInstruction` |
| `domain-scrape` | changed | fatwa-portal parsers |
| `mcp`, `backfill-embeddings` | changed | — |

> Changes under `_shared/` are bundled into **every** function at deploy time,
> so a redeploy of all functions is the right action, not just the two new ones.

`domain-scrape` is intentionally **not** in `config.toml`: it does no manual
bearer verification, so it must keep Supabase's default `verify_jwt = true`.
Adding it with `verify_jwt = false` would expose it unauthenticated.

---

## Step 3 — Set the API keys (Supabase → Edge Functions → Secrets)

| Secret | Needed by | If missing |
|---|---|---|
| `TAVILY_API_KEY` | `web-search` (Tier-4) | Returns empty results **and refunds the tokens** — no silent charge |
| `ELEVENLABS_API_KEY` | voice cloning | That feature stays off |

`HADITH_API_KEY` is **no longer needed** (2026-07-25): the hadith corpus is
ingested locally, so `extract-translations` and `islamic-api-fetch` read
`scholarly_documents` directly. No reference to the key remains anywhere in
`supabase/functions/`.

Already configured (no action): `GEMINI_API_KEY`, `LOVABLE_API_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INGEST_SHARED_SECRET`.

---

## Step 4 — Smoke-test in the running app

| # | Where | Do | Expect |
|---|---|---|---|
| 1 | `/extract` | Enter `quran:2:255`, keep default translators, run | Arabic ayah + one row per selected translator, each with a source link. **No text under a translator that didn't return one** — missing ones are listed as unavailable |
| 2 | `/extract` | Run the same reference again | Instant (served from `passage_translations`), and no token charge |
| 3 | `/extract` | Enter `hadith:bukhari:1` | The Arabic matn **of hadith #1 specifically** + any ingested renderings, each with the source book named in the مترجم column. If the reference isn't in the corpus: an explicit note, never invented text. Cross-check the number against the printed collection — an off-by-one here means the passage_key backfill is misaligned |
| 4 | `/extract` | Click the row insert icon, then "ایڈیٹر میں کھولیں" | Editor opens with the passage as a blockquote + citation line |
| 5 | `/research` | Open the 14-prompt modal | Prompts whose corpus isn't ingested show the "ذخیرہ زیرِ تعمیر — غیر مصدقہ" badge; picking a grounded prompt switches to Islamic mode |
| 6 | `/translate-workspace` | Create a project, add a chunk, hit AI translate | Translation streams in. Re-using the same source text later suggests the earlier translation (TM), only from projects with the same target language |
| 7 | `/book-workspace` | Run خطة البحث on a topic | Real streamed analysis + an amber caveat that this is not a full survey. If no chapter headings could be parsed it says so — it must never show a generic الباب الأول/الثاني skeleton |
| 8 | `/book-workspace` | Click "فُٹ نوٹ +" | Inserts an **empty** `[^1]: ` scaffold — never a pre-filled reference |
| 9 | anywhere | Sign in as an unapproved user | Still fully locked out (approval gate untouched) |

Tests 1, 3, 7 and 8 are the ones that matter most: they are the exact places
where earlier drafts of this code showed fabricated scholarly content.

---

## Outstanding — hadith embedding backfill

As of the 2026-07-25 corpus load, `scholarly_documents` holds ~350k rows but
only ~153k (44%) have a vector:

| domain | embedded |
|---|---|
| quran | 12,472 / 12,472 ✅ |
| classical | 4,780 / 4,780 ✅ |
| hadith | 135,933 / 332,406 (41%) |
| Urdu-Hadith-Excel | 0 / 695 |

Until `run_embedding_backfill` finishes, roughly 197k hadiths are reachable
only through the **lexical/trigram** channel, not the semantic one. Retrieval
still works — RRF simply fuses one channel instead of two — so this degrades
recall rather than breaking anything. Re-run the counts above after the
backfill to confirm.

## Not covered by this deployment

- **Tier-2 classical corpus is empty.** `search_classical_scoped` and the
  engine's classical channel are live but return nothing until real fiqh /
  tafsir / fatawa / lughat / rijal books are ingested via
  `scripts/classical_to_csv.py` (see `scripts/CLASSICAL_INGEST.md`). Until then
  the fiqh/tafsir/rijal prompts stay marked unverified — that is correct, not a
  bug.
- **Classical semantic search** is deliberately not wired yet: it needs the
  embedding backfill plus `passage_key` on `match_scholarly_documents`, so that
  dedup stays consistent with the lexical rows.
- **Mufti Taqi Usmani / Clear Quran (Khattab)** are not in the translator
  registry — alquran.cloud publishes no edition for them, and seeding a dead
  edition id would show a permanently broken translator.
- **Hadith numbering alignment** between our corpus and HadithAPI has not been
  verified live (no key available while building). Check test #3 against a
  known hadith before relying on it; the `source_url` in each row lets you
  confirm against hadithapi.com.
