"""
One-off targeted load for hadith-scholarly.

Context: hadith_scholarly.csv (50,884 rows, regenerated 2026-07-25 from
db/by_book/ only -- see D:\\EEData\\ingestion_status.md for the by_book +
by_chapter duplication bug this fixed) is 99.4% already present in the DB
under domain='hadith-json' (--check-only found 50,590/50,884 existing,
matched by content_hash -- meaning the DB's pre-existing 83,295 rows came
from a cleaner/larger source and already cover almost all of this file).

Running the normal loader on the full file would mean ~50,590 of ~509
batches hit a conflict and fall through ingest-batch's slow per-row fallback
(same mechanism that made the hadeed-urdu load take 85 minutes at ~2%
conflict density -- this file is ~99.4% conflict density, so a full re-run
would be far slower for the same 294 useful rows). Instead: check every row
first, keep only the ones confirmed new, insert just those.

Usage:
  python scripts/load_hadith_scholarly_new_only.py --secret <INGEST_SHARED_SECRET>
  python scripts/load_hadith_scholarly_new_only.py --secret <...> --dry-run
"""
import csv
import os
import sys
import time
import argparse

sys.path.insert(0, os.path.dirname(__file__))
from supabase_bulk_load import (  # noqa: E402
    insert_batch, check_batch, log, BATCH_SIZE, _passthrough_row,
)

CSV_PATH = r"D:\EEData\hadith\hadith_scholarly.csv"


def find_new_rows(secret):
    with open(CSV_PATH, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        all_rows = [rec for row in reader if (rec := _passthrough_row(row)) is not None]

    log(f"Loaded {len(all_rows)} rows from CSV. Checking against DB...")

    new_rows = []
    for i in range(0, len(all_rows), BATCH_SIZE):
        batch = all_rows[i:i + BATCH_SIZE]
        results, err = check_batch(batch, secret)
        if err:
            log(f"  ERROR checking batch at row ~{i}: {err}")
            continue
        for rec, res in zip(batch, results):
            if not res.get("exists"):
                new_rows.append(rec)
        if (i // BATCH_SIZE) % 20 == 0:
            log(f"  Checked {i + len(batch)}/{len(all_rows)}, {len(new_rows)} new so far")
        time.sleep(0.05)

    return new_rows


def main():
    parser = argparse.ArgumentParser(description="Load only the genuinely-new rows from hadith-scholarly")
    parser.add_argument("--secret", help="INGEST_SHARED_SECRET (or set the env var)")
    parser.add_argument("--dry-run", action="store_true", help="Only report how many rows are new")
    args = parser.parse_args()

    secret = args.secret or os.environ.get("INGEST_SHARED_SECRET")
    if not secret:
        parser.error("--secret is required (or set INGEST_SHARED_SECRET)")

    new_rows = find_new_rows(secret)
    log(f"\nFound {len(new_rows)} genuinely new rows.")

    if args.dry_run:
        import json
        for rec in new_rows[:5]:
            log(json.dumps(rec, ensure_ascii=False)[:300])
        return

    if not new_rows:
        log("Nothing to insert.")
        return

    total_ok = total_dupes = total_errors = 0
    for i in range(0, len(new_rows), BATCH_SIZE):
        batch = new_rows[i:i + BATCH_SIZE]
        ok, dupes, err = insert_batch(batch, secret)
        total_ok += ok
        total_dupes += dupes
        if err:
            log(f"  ERROR at row ~{i}: {err}")
            total_errors += 1
        else:
            log(f"  {i + len(batch)}/{len(new_rows)}: +{ok} inserted, {dupes} dupes (total {total_ok})")
        time.sleep(0.1)

    log(f"\nDone: {total_ok:,} inserted, {total_dupes:,} unexpected duplicates, {total_errors} batch errors.")


if __name__ == "__main__":
    main()
