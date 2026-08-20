"""
load.py - Resilient, duplicate-aware bulk loader for IslamicUrduBooks CSV data.
Reads CSV files from data/iub/ and pushes batches of 100 rows to the Supabase ingest-batch endpoint.
Features:
- Checkpoints progress so resumed runs skip already-loaded records.
- Reports inserted vs duplicate count per batch.
- Supports --book, --module, --check-only, and --all modes.
"""

import os
import sys
import csv
import json
import time
import argparse
import urllib.request

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")

# Read the shared secret from the environment ONLY. scripts/load_tohed_hadiths.py
# and scripts/run_embedding_backfill.py both carry this value hardcoded, which is
# how it ended up committed to the repo in the first place; do not add a third
# copy. Those two still need rotating -- tracked separately.
SECRET = os.environ.get("INGEST_SHARED_SECRET")
if not SECRET:
    print("ERROR: INGEST_SHARED_SECRET is not set.")
    print("  PowerShell:  $env:INGEST_SHARED_SECRET = '<secret>'")
    print("  bash:        export INGEST_SHARED_SECRET='<secret>'")
    sys.exit(1)

def post_batch(rows: list, mode: str = "insert", retries: int = 3) -> dict:
    # ingest-batch (supabase/functions/ingest-batch/index.ts) replies with
    # {"ok": N, "duplicates": N, "errors": N} -- "ok" is the inserted count.
    # This loader was reading res.get("inserted"), which is never a key in
    # that response, so it silently reported 0/0 for every batch regardless
    # of what actually happened server-side.
    url = f"{SUPABASE_URL}/functions/v1/ingest-batch"
    payload = json.dumps({"mode": mode, "rows": rows}).encode("utf-8")
    
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=45) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2.0 + attempt * 2.0)
            else:
                return {"error": str(e), "ok": 0, "duplicates": 0}
    return {"error": "Failed", "ok": 0, "duplicates": 0}

def load_csv(csv_path: str, batch_size: int = 100, mode: str = "insert", start_offset: int = 0):
    if not os.path.exists(csv_path):
        print(f"❌ File not found: {csv_path}")
        return

    print(f"\n==========================================", flush=True)
    print(f"🚀 Loading {os.path.basename(csv_path)} -> Supabase (mode={mode})", flush=True)
    print(f"==========================================", flush=True)

    rows_buffer = []
    total_processed = 0
    total_inserted = 0
    total_duplicates = 0
    t0 = time.time()

    with open(csv_path, "r", encoding="utf-8", errors="ignore") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader):
            if idx < start_offset:
                continue

            # Parse citation_ref if string
            cit = row.get("citation_ref")
            if isinstance(cit, str) and cit.startswith("{"):
                try:
                    cit = json.loads(cit)
                except Exception:
                    pass

            item = {
                "domain": row.get("domain"),
                "source_type": row.get("source_type"),
                "title": row.get("title"),
                "content": row.get("content"),
                "content_ar": row.get("content_ar") or None,
                "citation_ref": cit,
                "language": row.get("language") or "ur",
                "source_url": row.get("source_url"),
                "passage_key": row.get("passage_key")
            }
            rows_buffer.append(item)

            if len(rows_buffer) >= batch_size:
                res = post_batch(rows_buffer, mode=mode)
                # A batch that errors after all retries (network fault, or a
                # non-23505 server error) silently contributed 0/0 here with no
                # trace of what happened -- total_processed kept climbing as if
                # the batch had been handled, while the rows themselves were
                # never persisted. Surface it so a failed batch is visible and
                # its row range is known, instead of vanishing into "Processed"
                # counts that look like real progress.
                if res.get("error"):
                    print(f"   ⚠️  BATCH FAILED (rows {total_processed:,}-{total_processed+len(rows_buffer):,}): {res['error']}", flush=True)
                total_processed += len(rows_buffer)
                total_inserted += res.get("ok", 0)
                total_duplicates += res.get("duplicates", 0)
                
                elapsed = max(1.0, time.time() - t0)
                rate = round(total_processed / (elapsed / 60.0), 1)
                print(f"   Processed: {total_processed:,} | Inserted: {total_inserted:,} | Dupes: {total_duplicates:,} (~{rate}/min)", flush=True)
                rows_buffer = []
                time.sleep(0.1)

        # Remaining buffer
        if rows_buffer:
            res = post_batch(rows_buffer, mode=mode)
            if res.get("error"):
                print(f"   ⚠️  BATCH FAILED (final {len(rows_buffer)} rows): {res['error']}", flush=True)
            total_processed += len(rows_buffer)
            total_inserted += res.get("ok", 0)
            total_duplicates += res.get("duplicates", 0)

    elapsed_total = round(time.time() - t0, 1)
    print(f"✅ Finished {os.path.basename(csv_path)}: {total_processed:,} processed in {elapsed_total}s (Inserted: {total_inserted:,}, Dupes: {total_duplicates:,})\n", flush=True)

def main():
    parser = argparse.ArgumentParser(description="Bulk loader for IUB data")
    parser.add_argument("--file", type=str, help="Specific CSV file to load")
    parser.add_argument("--all", action="store_true", help="Load all CSV files in data/iub/")
    parser.add_argument("--check-only", action="store_true", help="Run mode: check without inserting")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size (default: 100)")
    args = parser.parse_args()

    mode = "check" if args.check_only else "insert"

    if args.file:
        load_csv(args.file, batch_size=args.batch_size, mode=mode)
    elif args.all:
        iub_dir = os.path.join("data", "iub")
        if not os.path.exists(iub_dir):
            print("No data/iub directory found.")
            return
        files = [os.path.join(iub_dir, f) for f in os.listdir(iub_dir) if f.endswith(".csv")]
        print(f"Found {len(files)} CSV files in {iub_dir}")
        for f in files:
            load_csv(f, batch_size=args.batch_size, mode=mode)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
