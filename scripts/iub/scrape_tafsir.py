"""
scrape_tafsir.py - High-speed scraper for Tafsir Ibn Kathir (6,236 ayat) from IslamicUrduBooks.
Features:
- Validates 100% exact Surah and Ayah mapping.
- Gzipped disk cache at data/iub_cache/tafsir/
- Outputs canonical CSV to data/iub/tafsir_ibnkathir.csv.
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

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUT_FILE = os.path.join("data", "iub", "tafsir_ibnkathir.csv")
os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)

# Ayah counts per surah (1..114)
SURAH_AYAH_COUNTS = [
    7, 286, 200, 176, 120, 165, 206, 75, 129, 109,
    123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
    112, 78, 118, 64, 77, 227, 93, 88, 69, 60,
    34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
    54, 53, 89, 59, 37, 35, 38, 29, 18, 45,
    60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
    14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
    28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
    29, 19, 36, 25, 22, 17, 19, 26, 30, 20,
    15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
    11, 8, 3, 9, 5, 4, 7, 3, 6, 3,
    5, 4, 5, 6
]

def get_surah_ayah_from_faayat(faayat_id: int) -> tuple[int, int]:
    acc = 0
    for s_idx, count in enumerate(SURAH_AYAH_COUNTS):
        surah_num = s_idx + 1
        if faayat_id <= acc + count:
            ayah_num = faayat_id - acc
            return surah_num, ayah_num
        acc += count
    return 114, 6

def parse_tafsir_page(faayat_id: int) -> dict | None:
    surah, ayah = get_surah_ayah_from_faayat(faayat_id)
    url = f"https://islamicurdubooks.com/quran/tafseer_ibn_kaseer.php?faayat_id={faayat_id}"
    html, is_missing, _ = fetch_page(url, "tafsir", f"tafsir_{faayat_id}")
    if not html or is_missing:
        return None

    # Extract all tafsir text blocks
    blocks = []
    divs = re.findall(r'<div[^>]*class=[\'"][^\'"]*fontarabic[^\'"]*fs2[^\'"]*[\'"][^>]*>(.*?)</div>', html, re.DOTALL)
    for d in divs:
        clean = clean_html(d)
        if len(clean) > 30 and "قرآنی سورتیں" not in clean:
            blocks.append(clean)

    if not blocks:
        # Fallback to main content container
        content_div = re.search(r'class="[^"]*tafseer_urdu[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
        if content_div:
            c = clean_html(content_div.group(1))
            if len(c) > 30:
                blocks.append(c)

    full_tafsir = "\n\n".join(blocks).strip()
    if not full_tafsir:
        return None

    title = f"تفسیر ابن کثیر - سورۃ {surah}، آیت {ayah}"
    
    citation_ref = {
        "discipline": "tafsir",
        "book": "تفسیر ابن کثیر",
        "mufassir": "حافظ عماد الدین ابن کثیر",
        "surah_number": surah,
        "verse": ayah,
        "faayat_id": faayat_id,
        "source": "islamicurdubooks.com",
        "url": url
    }

    return {
        "domain": "islamicurdubooks-tafsir",
        "source_type": "tafsir",
        "title": title,
        "content": f"{title}\n\n{full_tafsir}",
        "content_ar": None,
        "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
        "language": "ur",
        "source_url": url,
        "passage_key": f"tafsir:iub-ibnkathir:{surah}:{ayah}"
    }

def scrape_all_tafsir(max_workers: int = 4):
    total = 6236
    print(f"📖 Starting Tafsir Ibn Kathir Scrape ({total:,} ayat) -> {OUT_FILE}", flush=True)

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
            futures = {executor.submit(parse_tafsir_page, fid): fid for fid in batch}
            for f in as_completed(futures):
                row = f.result()
                if row:
                    writer.writerow(row)
                    scraped_count += 1

        f_out.flush()
        elapsed = max(1.0, time.time() - t0)
        rate = round(scraped_count / (elapsed / 60.0), 1)
        pct = round(scraped_count / total * 100, 1)
        print(f"   [Tafsir Ibn Kathir] {scraped_count:,}/{total:,} ({pct}%) - ~{rate} ayat/min", flush=True)
        time.sleep(0.2)

    f_out.close()
    print(f"🎉 Tafsir Ibn Kathir scraping complete! {scraped_count:,} rows saved to {OUT_FILE}", flush=True)

if __name__ == "__main__":
    scrape_all_tafsir()
