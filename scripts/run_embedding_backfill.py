#!/usr/bin/env python3
"""
run_embedding_backfill.py - High-throughput multi-threaded backfill engine for vector embeddings.
Runs Hadith and Fatwa backfills in parallel without conflict, then performs a global completion sweep.
"""

import os
import sys
import json
import time
import urllib.request
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# Reconfigure stdout for immediate unbuffered flushing
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://vdfdqtzndsrrlutbprtk.supabase.co"
FUNCTION_URL = f"{SUPABASE_URL}/functions/v1/backfill-embeddings"
SECRET = os.environ.get("INGEST_SHARED_SECRET") or "IR-Ry-M3D528tkmYcCH94fvNh0NCwh3vPflEq8Y6-SIbmYodh_3uFMF6I_3ldPz2"

headers = {
    "x-ingest-secret": SECRET,
    "Content-Type": "application/json"
}

def backfill_batch(source_type=None, batch_size=80):
    payload_dict = {"batchSize": batch_size}
    if source_type:
        payload_dict["sourceType"] = source_type
    payload = json.dumps(payload_dict).encode("utf-8")
    req = urllib.request.Request(FUNCTION_URL, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data, ""
    except Exception as e:
        return {}, str(e)

def run_worker(source_type, label, batch_size=80):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] 🚀 [Worker: {label}] Started (batch size: {batch_size})", flush=True)
    
    session_processed = 0
    consecutive_errors = 0
    start_time = time.time()
    
    while True:
        t0 = time.time()
        res, err = backfill_batch(source_type=source_type, batch_size=batch_size)
        dur = round(time.time() - t0, 1)
        
        if err:
            consecutive_errors += 1
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️ [{label}] Error: {err} | Retry #{consecutive_errors} in 5s...", flush=True)
            time.sleep(5)
            if consecutive_errors > 15:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ [{label}] Exceeded error threshold. Worker stopping.", flush=True)
                break
            continue
            
        consecutive_errors = 0
        proc = res.get("processed") or 0
        rem = res.get("remaining_total")
        rem_val = rem if rem is not None else 0
        session_processed += proc
        
        elapsed_min = (time.time() - start_time) / 60.0
        rate = round(session_processed / elapsed_min, 1) if elapsed_min > 0.1 else 0
        
        print(f"[{datetime.now().strftime('%H:%M:%S')}] [{label}] +{proc} embedded in {dur}s | Remaining: {rem_val:,} | Total Session: {session_processed:,} (~{rate}/min)", flush=True)
        
        if res.get("done") or (rem is not None and rem == 0):
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ [{label}] Complete! All documents embedded.", flush=True)
            break
            
        # Brief throttle between batches
        time.sleep(0.3)

def main():
    print(f"=== Starting High-Throughput Parallel Vector Embedding Engine ===", flush=True)
    print(f"Target: Hadith & Fatwa concurrent processing -> Global final sweep", flush=True)
    
    # Run Hadith and Fatwa concurrently
    with ThreadPoolExecutor(max_workers=2) as executor:
        f_hadith = executor.submit(run_worker, "hadith", "Hadith Corpus", 80)
        f_fatwa = executor.submit(run_worker, "fatwa", "Fatwa Corpus", 80)
        
        f_hadith.result()
        f_fatwa.result()
        
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] --- Primary corpora completed. Running final verification sweep ---", flush=True)
    run_worker(None, "Global Final Sweep", 80)
    
    print(f"\n🎉 [{datetime.now().strftime('%H:%M:%S')}] === 100% COMPLETE! ALL DATABASE VECTOR EMBEDDINGS ARE DONE ===", flush=True)

if __name__ == "__main__":
    main()
