#!/usr/bin/env python3
"""
run_embedding_backfill.py - Continuous loop to generate vector embeddings for all remaining Hadiths.
"""

import os
import sys
import json
import time
import urllib.request

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://vdfdqtzndsrrlutbprtk.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/backfill-embeddings"
SECRET = os.environ.get("INGEST_SHARED_SECRET") or "IR-Ry-M3D528tkmYcCH94fvNh0NCwh3vPflEq8Y6-SIbmYodh_3uFMF6I_3ldPz2"

headers = {
    "x-ingest-secret": SECRET,
    "Content-Type": "application/json"
}

def backfill_batch(source_type="hadith", batch_size=50):
    payload = json.dumps({"batchSize": batch_size, "sourceType": source_type}).encode("utf-8")
    req = urllib.request.Request(FUNCTION_URL, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data, ""
    except Exception as e:
        return {}, str(e)

def main():
    print("=== Continuous Vector Embedding Backfill Engine ===")
    total_processed = 0
    
    while True:
        res, err = backfill_batch("hadith", batch_size=50)
        if err:
            print(f"Error calling backfill-embeddings: {err}. Retrying in 5s...")
            time.sleep(5)
            continue
            
        proc = res.get("processed") or 0
        rem = res.get("remaining_total")
        rem_val = rem if rem is not None else 0
        total_processed += proc
        
        print(f"Batch completed: processed {proc} hadiths | Remaining to embed: {rem_val:,} | Total Session Embedded: {total_processed:,}")
        
        if res.get("done") or (rem is not None and rem == 0):
            print("\n=== Vector Embedding Backfill 100% COMPLETE! All documents embedded! ===")
            break
            
        # Brief pause between API calls to avoid rate limits
        time.sleep(0.5)

if __name__ == "__main__":
    main()
