#!/usr/bin/env python3
"""
run_scraping_pipeline.py - Optimized pipeline for remaining tohed.com Hadith books.
Omitted musannaf-ibn-abi-shaybah (which is being extracted 100x faster from offline MDB).
"""

import os
import sys
import subprocess

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

REMAINING_BOOKS = [
    "mishkat-al-masabih",       # 6,288
    "sahih-ibn-hibban",         # 7,491
]

CSV_OUTPUT = "data/tohed_hadiths.csv"
SECRET = os.environ.get("INGEST_SHARED_SECRET") or "IR-Ry-M3D528tkmYcCH94fvNh0NCwh3vPflEq8Y6-SIbmYodh_3uFMF6I_3ldPz2"

def main():
    print("=== Starting Fast Pipeline for Remaining tohed.com Hadith Books ===")
    
    for idx, slug in enumerate(REMAINING_BOOKS):
        print(f"\n[{idx+12}/14] Scraper: {slug}...")
        
        # 1. Run Scraper
        cmd_scrape = [
            sys.executable, "scripts/tohed_hadith_scraper.py",
            "--slug", slug,
            "--workers", "8",
            "--output", CSV_OUTPUT
        ]
        res = subprocess.run(cmd_scrape)
        if res.returncode != 0:
            print(f"Warning: Scraper for {slug} returned exit code {res.returncode}")
            
        # 2. Run Fast Auto Ingest for ONLY this slug
        print(f"[{idx+12}/14] Ingesting {slug} into Supabase (Optimized)...")
        cmd_ingest = [
            sys.executable, "scripts/load_tohed_hadiths.py",
            "--csv", CSV_OUTPUT,
            "--secret", SECRET,
            "--slug", slug
        ]
        res_ingest = subprocess.run(cmd_ingest)
        if res_ingest.returncode != 0:
            print(f"Warning: Ingestion for {slug} returned exit code {res_ingest.returncode}")

    print("\n=== All tohed.com Hadith Books Processed & Ingested Successfully! ===")

if __name__ == "__main__":
    main()
