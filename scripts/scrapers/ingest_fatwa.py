#!/usr/bin/env python3
"""
ingest_fatwa.py - Batch ingest scraped fatwas into Supabase scholarly_documents.

Usage:
  python scripts/scrapers/ingest_fatwa.py [--csv data/urdufatwa_normalized.csv] [--secret <INGEST_SECRET>]
"""

import os
import sys
import csv
import json
import time
import argparse
import urllib.request
import urllib.error

# Reconfigure stdout for UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/ingest-batch"
DEFAULT_SECRET = os.environ.get("INGEST_SHARED_SECRET") or "IR-Ry-M3D528tkmYcCH94fvNh0NCwh3vPflEq8Y6-SIbmYodh_3uFMF6I_3ldPz2"

BATCH_SIZE = 100

def post_batch(batch, secret):
    payload = json.dumps({"mode": "insert", "rows": batch}).encode("utf-8")
    headers = {
        "x-ingest-secret": secret,
        "Content-Type": "application/json"
    }
    req = urllib.request.Request(FUNCTION_URL, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("ok", 0), data.get("duplicates", 0), 0, ""
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="ignore")
        return 0, 0, 1, f"HTTP {e.code}: {err_body[:300]}"
    except Exception as e:
        return 0, 0, 1, str(e)

def main():
    parser = argparse.ArgumentParser(description="Ingest Fatwas into Supabase")
    parser.add_argument("--csv", default="data/urdufatwa_normalized.csv", help="Path to normalized fatwas CSV")
    parser.add_argument("--secret", default=DEFAULT_SECRET, help="Ingest shared secret")
    parser.add_argument("--limit", type=int, default=0, help="Limit max rows to ingest (0 = all)")
    args = parser.parse_args()

    if not os.path.exists(args.csv):
        print(f"Error: CSV file not found at {args.csv}")
        sys.exit(1)

    print(f"=== Starting Fatwa Ingestion into Supabase ({args.csv}) ===")
    
    total_processed = 0
    total_inserted = 0
    total_existing = 0
    errors = 0
    
    batch = []
    start_time = time.time()

    with open(args.csv, "r", encoding="utf-8", errors="ignore") as f:
        reader = csv.DictReader(f)
        for row in reader:
            fatwa_id = (row.get("fatwa_id") or "").strip()
            title = (row.get("title") or "").strip()
            content = (row.get("content") or "").strip()
            scholar = (row.get("scholar") or "").strip()
            category = (row.get("category") or "").strip()
            source_url = (row.get("url") or "").strip()

            if not content or len(content) < 20:
                continue

            doc_content = f"{title}\n\n{content}" if title and not content.startswith(title[:15]) else content
            
            doc_rec = {
                "domain": "urdufatwa",
                "source_type": "fatwa",
                "title": title[:300],
                "content": doc_content[:8000],
                "content_ar": "",
                "language": "ur",
                "source_url": source_url[:500],
                "passage_key": f"fatwa:urdufatwa:{fatwa_id}" if fatwa_id else "",
                "citation_ref": {
                    "discipline": "fatwa",
                    "fatwa_number": fatwa_id,
                    "scholar": scholar,
                    "category": category,
                    "source": "urdufatwa.com",
                    "url": source_url,
                }
            }

            batch.append(doc_rec)
            total_processed += 1

            if len(batch) >= BATCH_SIZE:
                ins, ex, err, err_msg = post_batch(batch, args.secret)
                total_inserted += ins
                total_existing += ex
                errors += err
                if err_msg:
                    print(f"Batch Error: {err_msg}")
                batch = []
                
                if total_processed % 1000 == 0:
                    elapsed = time.time() - start_time
                    print(f"Progress: {total_processed:,} processed | {total_inserted:,} new inserted | {total_existing:,} existing skipped ({elapsed:.1f}s)")

            if args.limit > 0 and total_processed >= args.limit:
                break

    if batch:
        ins, ex, err, err_msg = post_batch(batch, args.secret)
        total_inserted += ins
        total_existing += ex
        errors += err
        if err_msg:
            print(f"Batch Error: {err_msg}")

    elapsed = time.time() - start_time
    print(f"\n=== Ingestion Finished! ===")
    print(f"Total Rows Processed: {total_processed:,}")
    print(f"New Rows Inserted: {total_inserted:,}")
    print(f"Existing/Duplicate Skipped: {total_existing:,}")
    print(f"Time Taken: {elapsed:.1f} seconds")

if __name__ == "__main__":
    main()
