"""
backup_citations.py - Phase E step 1.4: backup every row about to be updated,
before apply_citation_urls.py writes anything.

Reads every data/iub_index/{slug}_matches.json (produced by
build_book_index.py), resolves each MATCH row's own db_hadith_number to the
actual DB row it targets, and dumps id/passage_key/citation_ref/source_url
for all of them to data/citation_backup_{timestamp}.csv plus a generated
data/citation_rollback_{timestamp}.sql that restores exactly those columns by
id if the apply step needs to be undone.

This is a one-way bulk UPDATE over a six-figure row count with no other undo
path -- apply_citation_urls.py refuses to run without a backup file from the
SAME invocation's timestamp.
"""

import os
import re
import sys
import csv
import json
import time
import glob
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
SECRET = os.environ.get("INGEST_SHARED_SECRET")
if not SECRET:
    sys.exit("ERROR: INGEST_SHARED_SECRET is not set. Export it before running.")

INDEX_DIR = os.path.join("data", "iub_index")
LOOKUP_BATCH = 200  # 500-row batches measured ~9s server-side, over the RPC default timeout; see 20260820010000_lookup_by_citation_timeout_fix.sql


def lookup_full_rows(pairs):
    """pairs: list of (collection, hadith_number:int) -> list of full row dicts.

    Retries each chunk on failure -- a dropped chunk here silently means those
    rows never make it into the backup CSV, and apply_citation_urls.py's
    backup-completeness check (rows_backed_up >= 99% of planned writes) exists
    specifically to catch that, but retrying first means it doesn't have to."""
    out = []
    for i in range(0, len(pairs), LOOKUP_BATCH):
        chunk = pairs[i:i + LOOKUP_BATCH]
        rows = [{"collection": c, "hadith_number": str(n)} for c, n in chunk]
        payload = json.dumps({"mode": "lookup-citation", "rows": rows}).encode("utf-8")
        data = None
        for attempt in range(4):
            req = urllib.request.Request(
                f"{SUPABASE_URL}/functions/v1/ingest-batch",
                data=payload,
                headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                break
            except Exception as e:
                if attempt < 3:
                    print(f"   lookup batch retry {attempt+1}/3 at {i}: {e}", flush=True)
                    time.sleep(3 + attempt * 3)
                else:
                    print(f"   lookup batch FAILED after retries at {i}: {e}", flush=True)
        if data is None:
            continue
        out.extend(data.get("results", []))
        print(f"   resolved {min(i+LOOKUP_BATCH, len(pairs)):,}/{len(pairs):,}", flush=True)
    return out


def collect_targets():
    """Returns {(db_collection, db_hadith_number): iub_hadith_number} for
    every row that will actually be updated, across all *_matches.json files.
    Keyed on db_collection (the corpus's real citation_ref.collection value),
    NOT the IUB registry slug -- they differ for most of the 25 target books;
    see registry.py's module docstring.

    Multiple IUB hadith_numbers can land on the same db_hadith_number
    (confirmed live 2026-08-23: 37,055 raw MATCH rows resolve to only
    ~33,080 distinct DB targets -- almost always a genuine repeated
    narration, e.g. Bukhari's mukarrarat). Only one citation can be written
    per DB row, so this picks the HIGHEST-ratio match as canonical --
    apply_citation_urls.py's build_plan() must use the exact same rule, or
    the two scripts would back up a different row than the one actually
    written."""
    best = {}  # (db_collection, db_hadith_number) -> (iub_hadith_number, ratio)
    for path in sorted(glob.glob(os.path.join(INDEX_DIR, "*_matches.json"))):
        data = json.load(open(path, encoding="utf-8"))
        db_collection = data["db_collection"]
        for n_str, m in data["matches"].items():
            if m["result"] != "MATCH":
                continue
            n = int(n_str)
            db_n = int(m["db_hadith_number"])
            ratio = m.get("ratio", 0.0)
            key = (db_collection, db_n)
            if key not in best or ratio > best[key][1]:
                best[key] = (n, ratio)
    return {key: n for key, (n, ratio) in best.items()}


def main():
    targets = collect_targets()
    if not targets:
        sys.exit(
            "No MATCH rows found in data/iub_index/*_matches.json.\n"
            "Run probe_alignment.py then build_book_index.py first."
        )

    print(f"=== Resolving {len(targets):,} rows to back up ===", flush=True)
    pairs = list(targets.keys())
    rows = lookup_full_rows(pairs)

    ts = time.strftime("%Y%m%d_%H%M%S")
    os.makedirs("data", exist_ok=True)
    backup_csv = os.path.join("data", f"citation_backup_{ts}.csv")
    rollback_sql = os.path.join("data", f"citation_rollback_{ts}.sql")
    manifest = os.path.join("data", f"citation_backup_{ts}.manifest.json")

    written = 0
    missing = 0
    with open(backup_csv, "w", encoding="utf-8", newline="") as f_csv, \
         open(rollback_sql, "w", encoding="utf-8") as f_sql:

        writer = csv.writer(f_csv)
        writer.writerow(["id", "passage_key", "citation_ref", "source_url"])

        f_sql.write(f"-- Rollback for citation_backup_{ts}.csv\n")
        f_sql.write("-- Restores citation_ref and source_url to their pre-apply values, by id.\n")
        f_sql.write("BEGIN;\n\n")

        for r in rows:
            row_id = r.get("id")
            if not row_id:
                missing += 1
                continue
            passage_key = r.get("passage_key") or ""
            citation_ref = r.get("citation_ref") or {}
            source_url = r.get("source_url") or ""

            writer.writerow([row_id, passage_key, json.dumps(citation_ref, ensure_ascii=False), source_url])

            cr_literal = json.dumps(citation_ref, ensure_ascii=False).replace("'", "''")
            su_literal = source_url.replace("'", "''")
            f_sql.write(
                f"UPDATE public.scholarly_documents SET "
                f"citation_ref = '{cr_literal}'::jsonb, "
                f"source_url = '{su_literal}' "
                f"WHERE id = '{row_id}';\n"
            )
            written += 1

        f_sql.write("\nCOMMIT;\n")

    with open(manifest, "w", encoding="utf-8") as f:
        json.dump({
            "timestamp": ts,
            "rows_backed_up": written,
            "rows_missing": missing,
            "target_rows_requested": len(targets),
            "backup_csv": backup_csv,
            "rollback_sql": rollback_sql,
        }, f, indent=2)

    print(f"\n✅ Backed up {written:,} rows ({missing} could not be resolved -- see below)")
    print(f"   CSV:      {backup_csv}")
    print(f"   Rollback: {rollback_sql}")
    print(f"   Manifest: {manifest}")
    if missing:
        print(f"\n⚠️  {missing} target rows had no id returned by lookup-citation -- "
              f"they will be SKIPPED by apply_citation_urls.py, not force-updated.")


if __name__ == "__main__":
    main()
