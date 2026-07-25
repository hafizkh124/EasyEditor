#!/usr/bin/env python3
"""
extract_additional_hadith_books.py - Extracts Musnad Ahmad (Book 11) and Sunan Al-Kubra lil-Bayhaqi (Book 15)
from EasyHadees.dat into canonical scholarly_documents CSV and ingests into Supabase.
"""

import os
import sys
import csv
import json
import subprocess
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

csv.field_size_limit(2147483647)

HADEES_DB_PATH = r"data\easyquran\EasyHadees.dat"
OUTPUT_CSV = r"data\easyquran_additional_books.csv"
SECRET = os.environ.get("INGEST_SHARED_SECRET") or "IR-Ry-M3D528tkmYcCH94fvNh0NCwh3vPflEq8Y6-SIbmYodh_3uFMF6I_3ldPz2"

TARGET_BOOKS = {
    11: {"slug": "musnad-ahmad",         "title": "مسند الإمام أحمد بن حنبل"},
    15: {"slug": "sunan-kubra-bayhaqi", "title": "سنن الكبرى للبيهقي"},
}

def clean_text(raw):
    if not raw or raw == "None":
        return ""
    return str(raw).strip()

def main():
    print("=== Extracting Musnad Ahmad (Book 11) & Sunan Al-Kubra lil-Bayhaqi (Book 15) ===")
    
    if not os.path.exists(HADEES_DB_PATH):
        print(f"Error: Database file '{HADEES_DB_PATH}' not found.")
        return
        
    db = AccessParser(HADEES_DB_PATH)
    print("Parsing 'Ahadith' table...")
    tbl = db.parse_table("Ahadith")
    
    cols = list(tbl.keys())
    num_rows = len(tbl[cols[0]])
    print(f"Total rows in Ahadith table: {num_rows:,}")
    
    records = []
    
    for i in range(num_rows):
        raw_b = tbl.get("Book", [None]*num_rows)[i]
        try:
            b_id = int(raw_b) if raw_b is not None else -1
        except Exception:
            b_id = -1
            
        if b_id not in TARGET_BOOKS:
            continue
            
        b_meta = TARGET_BOOKS[b_id]
        h_id = tbl.get("PartHNo", [None]*num_rows)[i] or (i + 1)
        
        ar_text = clean_text(tbl.get("ArabicText", [None]*num_rows)[i]) or clean_text(tbl.get("ArabicText_DS", [None]*num_rows)[i])
        ur_text = clean_text(tbl.get("UrduText", [None]*num_rows)[i]) or clean_text(tbl.get("UrduText_DS", [None]*num_rows)[i])
        chapter = clean_text(tbl.get("Chapter", [None]*num_rows)[i]) or clean_text(tbl.get("BaabUrdu_DS", [None]*num_rows)[i])
        takhreej = clean_text(tbl.get("Takhreej", [None]*num_rows)[i])
        grading = clean_text(tbl.get("HukamAjmali_DS", [None]*num_rows)[i])
        
        if not ar_text and not ur_text:
            continue
            
        content_components = []
        if chapter:
            content_components.append(f"موضوع/باب: {chapter}")
        if ar_text:
            content_components.append(f"المتن العربي:\n{ar_text}")
        if ur_text:
            content_components.append(f"الترجمة اردو:\n{ur_text}")
        if grading:
            content_components.append(f"الحكم/الدرجة: {grading}")
        if takhreej:
            content_components.append(f"التخريج والمصدر:\n{takhreej}")
            
        full_content = "\n\n".join(content_components)
        
        citation_ref = {
            "collection": b_meta["slug"],
            "book": b_meta["title"],
            "hadith_number": h_id,
            "chapter": chapter,
            "grading": grading,
            "takhreej": takhreej,
            "source": "Easy Quran Wa Hadees"
        }
        
        rec = {
            "domain": "easyquran-hadith",
            "source_type": "hadith",
            "title": f"{b_meta['title']} - حدیث {h_id}",
            "content": full_content,
            "content_ar": ar_text if ar_text else None,
            "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
            "language": "ur",
            "source_url": f"https://easyquranwahadees.com/hadith/{b_meta['slug']}/{h_id}",
            "passage_key": f"hadith:eqwh:{b_meta['slug']}:{h_id}:{i+1}"
        }
        records.append(rec)
        
    print(f"\nExtracted {len(records):,} total Hadiths for Musnad Ahmad and Sunan Al-Kubra lil-Bayhaqi.")
    
    os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
    fieldnames = ["domain", "source_type", "title", "content", "content_ar", "citation_ref", "language", "source_url", "passage_key"]
    
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in records:
            writer.writerow(r)
            
    print(f"Saved records to '{OUTPUT_CSV}'. Ingesting into Supabase...")
    
    cmd_ingest = [
        sys.executable, "scripts/load_tohed_hadiths.py",
        "--csv", OUTPUT_CSV,
        "--secret", SECRET
    ]
    res = subprocess.run(cmd_ingest)
    print(f"Ingestion finished with code {res.returncode}")

if __name__ == "__main__":
    main()
