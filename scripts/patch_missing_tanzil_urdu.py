"""
Same reconciliation as patch_missing_urdu_hadith.py, for the tanzil-urdu load.

10 distinct Urdu translation strings repeat across 32 verses -- not
translation errors, but real Quranic refrains (Ar-Rahman's "پس تم اپنے رب کی
کس کس نعمت کو جھٹلاؤ گے؟" 12x, the muqatta'at letters حٰم/الم/طٰسم opening
several surahs identically). scholarly_documents_content_hash_uidx kept the
first verse of each identical-text group and skipped the other 32 as
"duplicates" -- each one a real, distinct (surah, verse). Same fix as the
hadith script: append invisible zero-width-space markers to `content` for
every occurrence after the first in a group, then insert just those.

Must run AFTER the main tanzil-urdu load has fully finished.

Usage:
  python scripts/patch_missing_tanzil_urdu.py --secret <INGEST_SHARED_SECRET>
  python scripts/patch_missing_tanzil_urdu.py --secret <...> --dry-run
"""
import os
import sys
import time
import argparse
import collections

sys.path.insert(0, os.path.dirname(__file__))
from supabase_bulk_load import insert_batch, log, BATCH_SIZE, _urdu_junagarhi_line  # noqa: E402

TXT_PATH = r"D:\EEData\Urdu\tanzil-urdu-junagarhi\ur.junagarhi.txt"
ZWS = "​"


def find_rows_to_patch():
    with open(TXT_PATH, "r", encoding="utf-8") as f:
        all_rows = [rec for line in f if (rec := _urdu_junagarhi_line(line)) is not None]

    groups = collections.defaultdict(list)
    for rec in all_rows:
        groups[rec["content"]].append(rec)

    to_patch = []
    for content, recs in groups.items():
        if len(recs) <= 1:
            continue
        for occurrence_idx, rec in enumerate(recs[1:], start=2):
            patched = dict(rec)
            patched["content"] = rec["content"] + ZWS * (occurrence_idx - 1)
            to_patch.append(patched)

    return to_patch


def main():
    parser = argparse.ArgumentParser(description="Patch content-collision duplicates for tanzil-urdu")
    parser.add_argument("--secret", help="INGEST_SHARED_SECRET (or set the env var)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    to_patch = find_rows_to_patch()
    log(f"Found {len(to_patch)} rows needing a uniqueness marker (content collided with an earlier verse).")

    if args.dry_run:
        import json
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
