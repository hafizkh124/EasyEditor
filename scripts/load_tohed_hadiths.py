#!/usr/bin/env python3
"""
load_tohed_hadiths.py - Bulk loader for scraped tohed.com Hadith CSV into Supabase scholarly_documents.

Optimized to filter by collection slug and handle network retries cleanly.
"""

import os
import sys
import csv
import json
import time
import argparse
import urllib.request
import urllib.error

# Reconfigure stdout to utf-8
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

csv.field_size_limit(2147483647)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/ingest-batch"
BATCH_SIZE = 100

def _post_once(rows, secret, mode, max_retries=3):
    payload = json.dumps({"rows": rows, "mode": mode}, ensure_ascii=False).encode("utf-8")
    
    for attempt in range(max_retries):
        req = urllib.request.Request(
            FUNCTION_URL,
            data=payload,
            method="POST",
            headers={
                "x-ingest-secret": secret,
                "Content-Type": "application/json"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data, ""
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")[:300]
            if attempt == max_retries - 1:
                return {}, f"HTTP {e.code}: {body}"
            time.sleep(2 * (attempt + 1))
        except Exception as ex:
            if attempt == max_retries - 1:
                return {}, str(ex)
            time.sleep(2 * (attempt + 1))
            
    return {}, "Failed after retries"

def insert_batch(rows, secret):
    data, err = _post_once(rows, secret, "insert")
    ok, dupes = data.get("ok", 0), data.get("duplicates", 0)
    if not err:
        return ok, dupes, ""
    return ok, dupes, err

def process_csv(csv_path, secret, slug=None, start_offset=0):
    if not os.path.exists(csv_path):
        print(f"Error: CSV file '{csv_path}' not found.")
        return

    print(f"Reading CSV '{csv_path}'...")
    rows_to_process = []
    
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader):
            if idx < start_offset:
                continue
                
            cref_str = row.get("citation_ref", "{}")
            try:
                cref_obj = json.loads(cref_str)
            except Exception:
                cref_obj = {}
                
            if slug and cref_obj.get("collection") != slug:
                continue
                
            item = {
                "domain": row.get("domain", "tohed-hadith"),
                "source_type": row.get("source_type", "hadith"),
                "title": row.get("title", ""),
                "content": row.get("content", ""),
                "content_ar": row.get("content_ar") or None,
                "citation_ref": cref_obj,
                "language": row.get("language", "ur"),
                "source_url": row.get("source_url", ""),
                "passage_key": row.get("passage_key", "")
            }
            rows_to_process.append(item)

    total_rows = len(rows_to_process)
    print(f"Total rows to process for target slug '{slug or 'ALL'}': {total_rows}")

    print("Running INSERT mode...")
    total_ok = 0
    total_dupes = 0
    
    for i in range(0, total_rows, BATCH_SIZE):
        batch = rows_to_process[i:i+BATCH_SIZE]
        ok, dupes, err = insert_batch(batch, secret)
        total_ok += ok
        total_dupes += dupes
        
        if err:
            print(f"  Batch {i}-{i+len(batch)} ERROR: {err}")
        else:
            print(f"  Batch {i}-{i+len(batch)}: Inserted {ok}, Duplicates {dupes} (Total OK: {total_ok})")

    print(f"\nIngestion Complete! Total Inserted: {total_ok}, Total Duplicates Skipped: {total_dupes}")

def main():
    parser = argparse.ArgumentParser(description="Bulk load tohed Hadith CSV into Supabase")
    parser.add_argument("--csv", required=True, help="Path to scraped Hadith CSV")
    parser.add_argument("--secret", help="INGEST_SHARED_SECRET")
    parser.add_argument("--slug", help="Filter by specific book slug (e.g. musnad-shafii)")
    parser.add_argument("--start", type=int, default=0, help="Row offset to resume from")
    
    args = parser.parse_args()
    
    secret = args.secret or os.environ.get("INGEST_SHARED_SECRET") or "IR-Ry-M3D528tkmYcCH94fvNh0NCwh3vPflEq8Y6-SIbmYodh_3uFMF6I_3ldPz2"
    if not secret:
        print("Error: INGEST_SHARED_SECRET is required.")
        return

    process_csv(args.csv, secret, slug=args.slug, start_offset=args.start)

if __name__ == "__main__":
    main()
