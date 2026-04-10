

# MVP Implementation Plan: Quran + Hadith Research Engine

## Source-of-Truth Decisions

| Data Type | Canonical Source | Domain | Rationale |
|-----------|-----------------|--------|-----------|
| **Quran** | Tanzil (`D:\EEData\Quran\tanzil-dataset`) | `tanzil` | Complete 6,236 verses, Arabic + English, juz mapping. Existing ETL script (`tanzil_to_csv.py`) ready. |
| **Hadith** | AhmedBaset/hadith-json (`D:\EEData\Hadith\hadith-json-dataset`) | `hadith-json` | 17 collections, ~50K hadiths, structured JSON with Arabic + translations. Existing ETL script ready. |
| **Quran enrichment** | QUL mini-dump — inspect only, use for tafsir if structured well. NOT loaded in Phase 1. |
| **Hadith enrichment** | fawazahmed0 (`D:\EEData\Hadith\hadith-api-fawazahmed0`) — NOT loaded in Phase 1. Available for future narrator/grade enrichment. |
| **Urdu Quran** | Tanzil Urdu Junagarhi (`D:\EEData\Urdu\tanzil-urdu-junagarhi`) — loaded as additional content on Quran rows if file format matches Tanzil standard. |

## Files to Create/Modify

### 1. `scripts/load_quran_hadith.py` — Unified MVP Loader (CREATE)
Single Python script user runs locally at `D:\EEData`. Features:
- **Tanzil loader**: reads Arabic, English, Urdu Tanzil files → maps to `scholarly_documents` via Supabase REST API (service_role key)
- **Hadith-json loader**: reads all collection JSONs → maps to `scholarly_documents`
- `--dry-run` flag: parse and count without uploading
- `--resume` flag: skip rows where dedup index would conflict (uses `Prefer: resolution=merge-duplicates` header with `on_conflict`)
- `--source quran|hadith|all` flag: load one dataset or both
- Batch size: 500 rows per POST
- Retry on 429/5xx with exponential backoff
- Summary: rows loaded per source, skipped, failed, time elapsed
- **No embeddings** — loader only inserts text + citation_ref

### 2. DB Migration — Citation + FTS Indexes (CREATE)
New migration file with:
```sql
-- Quran exact citation lookup (surah + verse)
CREATE INDEX IF NOT EXISTS scholarly_documents_quran_citation_idx
  ON scholarly_documents USING btree (
    ((citation_ref->>'surah_number')::int),
    ((citation_ref->>'verse')::int)
  ) WHERE source_type = 'quran';

-- Hadith exact citation lookup (collection + number)
CREATE INDEX IF NOT EXISTS scholarly_documents_hadith_citation_idx
  ON scholarly_documents USING btree (
    (citation_ref->>'collection'),
    (citation_ref->>'hadith_number')
  ) WHERE source_type = 'hadith';

-- Arabic full-text search
CREATE INDEX IF NOT EXISTS scholarly_documents_content_ar_fts_idx
  ON scholarly_documents USING gin (
    to_tsvector('simple', coalesce(content_ar, ''))
  ) WHERE content_ar IS NOT NULL;

-- Combined content FTS (for English/Urdu queries)
CREATE INDEX IF NOT EXISTS scholarly_documents_content_fts_idx
  ON scholarly_documents USING gin (
    to_tsvector('simple', coalesce(content, ''))
  );
```

### 3. `supabase/functions/citation-lookup/index.ts` — Exact Citation API (CREATE)
New edge function supporting:
- `POST { type: "quran", surah: 2, verse: 255 }` → exact verse
- `POST { type: "hadith", collection: "bukhari", hadith_number: "7" }` → exact hadith
- `POST { type: "search", q: "keyword", source_type: "quran"|"hadith", limit: 10 }` → FTS keyword search
- Uses SQL queries on `citation_ref` JSONB + `to_tsvector` for keyword — no embeddings needed
- Authenticated, rate-limited, CORS-compliant

### 4. `supabase/functions/islamic-search/index.ts` — Add Keyword Search Path (MODIFY)
Add a new parallel fan-out path alongside existing Tier A/B/C:
- **Tier K (Keyword)**: when `tanzil` or `hadith-json` is in selected domains, do a `to_tsvector/to_tsquery` SQL search against `scholarly_documents` directly
- Returns local DB results in parallel with external API calls
- This ensures loaded Quran/Hadith data is immediately searchable without embeddings

### 5. `supabase/functions/vector-search/index.ts` — Update Domain List (MODIFY)
Add `'tanzil'` and `'hadith-json'` to `tierBDomains` array so future embeddings activate vector search for these sources.

### 6. `supabase/config.toml` — Add citation-lookup function config (MODIFY)
Add `[functions.citation-lookup]` with `verify_jwt = false`.

## Execution Order

1. **Create** `scripts/load_quran_hadith.py`
2. **Create** DB migration (citation + FTS indexes)
3. **Create** `citation-lookup` edge function
4. **Modify** `islamic-search` (add Tier K keyword path)
5. **Modify** `vector-search` (update domain list)
6. **Deploy** edge functions
7. **User runs** `python scripts/load_quran_hadith.py --key SERVICE_ROLE_KEY --source all` locally
8. **Test** citation lookup + keyword search + grounded AI answers

## Expected Row Counts
- Quran (Tanzil): ~6,236 rows
- Hadith (hadith-json): ~50,884 rows
- **Total: ~57,120 rows** — easily handled by REST API batching (~115 requests)

## What This Delivers
- Exact Quran verse lookup by surah:verse
- Exact Hadith lookup by collection + number
- Arabic keyword search across all loaded data
- Grounded AI answers using local DB results (Tier K) + external APIs (Tier A)
- No dependency on embeddings for launch

