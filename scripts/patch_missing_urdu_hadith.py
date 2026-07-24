"""
One-off reconciliation for the hadeed-urdu load.

Why this exists: scholarly_documents_content_hash_uidx is scoped
(domain, source_type, md5(content)) -- global within a domain, with no
awareness of citation identity. 315 distinct Urdu strings repeat across the
7 Excel files (mostly short editorial notes like "اس سند سے بھی، اسی طرح
مروی ہے" -- "narrated through this chain too, in the same way" -- used when
a book abbreviates a hadith already given in full elsewhere, plus 113 rows
where the source Excel's Urdu column is literally "0"). Each repeat is a
REAL, DISTINCT hadith with its own hadith_number and its own Arabic text --
only the short Urdu annotation collides. The main load kept the first
occurrence of each repeated string and skipped ~620 later ones as
"duplicates", which would have silently dropped ~620 real citations.

Fix: for every occurrence after the first in a content-collision group,
append invisible zero-width-space (U+200B) markers to `content` -- enough to
make md5(content) unique, nothing a reader ever sees -- and insert just
those rows. The first occurrence in each group was already inserted
unmodified by the main load; this script must only run AFTER that load has
fully finished, or its "which one is the first" bookkeeping (based on file
order) will race against rows the main load hasn't reached yet.

Usage:
  python scripts/patch_missing_urdu_hadith.py --secret <INGEST_SHARED_SECRET>
  python scripts/patch_missing_urdu_hadith.py --secret <...> --dry-run
"""
import csv
import json
import os
import sys
import time
import argparse
import collections

sys.path.insert(0, os.path.dirname(__file__))
from supabase_bulk_load import insert_batch, log, BATCH_SIZE  # noqa: E402

CSV_PATH = r"D:\EEData\hadith\hadeed_urdu_excel.csv"
ZWS = "​"


def _passthrough_row(row):
    cit_raw = row.get("citation_ref") or "{}"
    try:
        cit = json.loads(cit_raw)
        if not isinstance(cit, dict):
            cit = {"raw": cit_raw}
    except Exception:
        cit = {"raw": cit_raw}
    return {
        "domain":       row.get("domain") or "",
        "source_type":  row.get("source_type") or "",
        "content":      (row.get("content") or "")[:8000],
        "content_ar":   (row.get("content_ar") or "")[:8000],
        "citation_ref": cit,
        "language":     row.get("language") or "ar",
    }


def find_rows_to_patch():
    """Group rows by exact content in file order. Everything after the first
    occurrence in each group needs a uniqueness marker."""
    with open(CSV_PATH, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        all_rows = [_passthrough_row(row) for row in reader]

    groups = collections.defaultdict(list)
    for rec in all_rows:
        groups[rec["content"]].append(rec)

    to_patch = []
    for content, recs in groups.items():
        if len(recs) <= 1:
            continue
        for occurrence_idx, rec in enumerate(recs[1:], start=2):  # skip the first
            patched = dict(rec)
            patched["content"] = rec["content"] + ZWS * (occurrence_idx - 1)
            to_patch.append(patched)

    return to_patch


def main():
    parser = argparse.ArgumentParser(description="Patch content-collision duplicates for hadeed-urdu")
    parser.add_argument("--secret", help="INGEST_SHARED_SECRET (or set the env var)")
    parser.add_argument("--dry-run", action="store_true", help="Just report how many rows would be patched")
    args = parser.parse_args()

    to_patch = find_rows_to_patch()
    log(f"Found {len(to_patch)} rows needing a uniqueness marker (content collided with an earlier row).")

    if args.dry_run:
        for rec in to_patch[:5]:
            log(json.dumps(rec, ensure_ascii=False, indent=2))
        return

    secret = args.secret or os.environ.get("INGEST_SHARED_SECRET")
    if not secret:
        parser.error("--secret is required (or set INGEST_SHARED_SECRET)")

    total_ok = total_dupes = total_errors = 0
    for i in range(0, len(to_patch), BATCH_SIZE):
        batch = to_patch[i:i + BATCH_SIZE]
        ok, dupes, err = insert_batch(batch, secret)
        total_ok += ok
        total_dupes += dupes
        if err:
            log(f"  ERROR at row ~{i}: {err}")
            total_errors += 1
        else:
            log(f"  {i + len(batch)}/{len(to_patch)}: +{ok} inserted, {dupes} dupes (total {total_ok})")
        time.sleep(0.1)

    log(f"\nDone: {total_ok:,} patched rows inserted, {total_dupes:,} unexpected duplicates, {total_errors} batch errors.")


if __name__ == "__main__":
    main()
