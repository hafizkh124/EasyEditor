"""
scrape_wbw.py - High-speed scraper for Quran Word-by-Word Translation (6,236 ayat) from IslamicUrduBooks.
Outputs canonical CSV to data/iub/quran_wbw.csv.
"""

import os
import sys
import csv
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.client import fetch_page
from scripts.iub.scrape_hadith import clean_html, CSV_HEADERS
from scripts.iub.scrape_tafsir import get_surah_ayah_from_faayat

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUT_FILE = os.path.join("data", "iub", "quran_wbw.csv")
os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)

def parse_wbw_page(faayat_id: int) -> dict | None:
    surah, ayah = get_surah_ayah_from_faayat(faayat_id)
    url = f"https://islamicurdubooks.com/quran/quran_word_by_word.php?faayat_id={faayat_id}"
    html, is_missing, _ = fetch_page(url, "wbw", f"wbw_{faayat_id}")
    if not html or is_missing:
        return None

    # Extract word-by-word tables
    tables = re.findall(r'<table[^>]*>(.*?)</table>', html, re.DOTALL)
    words_data = []

    for tbl in tables:
        rows = re.findall(r'<tr[^>]*>(.*?)</tr>', tbl, re.DOTALL)
        if len(rows) >= 2:
            ar_tds = re.findall(r'<td[^>]*>(.*?)</td>', rows[0], re.DOTALL)
            ur_tds = re.findall(r'<td[^>]*>(.*?)</td>', rows[1], re.DOTALL)
            for ar, ur in zip(ar_tds, ur_tds):
                clean_ar = clean_html(ar)
                clean_ur = clean_html(ur)
                if clean_ar and clean_ur:
                    words_data.append(f"{clean_ar} : {clean_ur}")

    if not words_data:
        return None

    title = f"لفظی ترجمہ قرآن - سورۃ {surah}، آیت {ayah}"
    full_content = f"{title}\n\n" + "\n".join(words_data)

    citation_ref = {
        "surah_number": surah,
        "verse": ayah,
        "faayat_id": faayat_id,
        "source": "islamicurdubooks.com",
        "url": url
    }

    return {
        "domain": "islamicurdubooks-wbw",
        "source_type": "quran-wordbyword",
        "title": title,
        "content": full_content,
        "content_ar": None,
        "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
        "language": "ur",
        "source_url": url,
        "passage_key": f"wbw:iub:{surah}:{ayah}"
    }

def scrape_all_wbw(max_workers: int = 4):
    total = 6236
    print(f"📖 Starting Quran Word-by-Word Scrape ({total:,} ayat) -> {OUT_FILE}", flush=True)

    existing_ids = set()
    if os.path.exists(OUT_FILE):
        with open(OUT_FILE, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f)
            for r in reader:
                try:
                    cit = json.loads(r.get("citation_ref") or "{}")
                    fid = cit.get("faayat_id")
                    if fid:
                        existing_ids.add(int(fid))
                except Exception:
                    pass
        print(f"Found existing {len(existing_ids):,} ayat in CSV. Resuming...", flush=True)

    pending_ids = [fid for fid in range(1, total + 1) if fid not in existing_ids]
    if not pending_ids:
        print(f"✅ All {total:,} ayat already scraped!", flush=True)
        return

    file_exists = os.path.exists(OUT_FILE) and os.path.getsize(OUT_FILE) > 0
    f_out = open(OUT_FILE, "a", encoding="utf-8", newline="")
    writer = csv.DictWriter(f_out, fieldnames=CSV_HEADERS)
    if not file_exists:
        writer.writeheader()
        f_out.flush()

    scraped_count = len(existing_ids)
    t0 = time.time()

    batch_size = 50
    for i in range(0, len(pending_ids), batch_size):
        batch = pending_ids[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(parse_wbw_page, fid): fid for fid in batch}
            for f in as_completed(futures):
                row = f.result()
                if row:
                    writer.writerow(row)
                    scraped_count += 1

        f_out.flush()
        elapsed = max(1.0, time.time() - t0)
        rate = round(scraped_count / (elapsed / 60.0), 1)
        pct = round(scraped_count / total * 100, 1)
        print(f"   [Quran WBW] {scraped_count:,}/{total:,} ({pct}%) - ~{rate} ayat/min", flush=True)
        time.sleep(0.2)

    f_out.close()
    print(f"🎉 Quran Word-by-Word scraping complete! {scraped_count:,} rows saved to {OUT_FILE}", flush=True)

if __name__ == "__main__":
    scrape_all_wbw()
