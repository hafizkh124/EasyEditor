"""
scrape_rijal.py - Multi-threaded scraper for IslamicUrduBooks Narrators (اسماء الرجال / رواۃ الحدیث).
Discovers narrator IDs across all Arabic alphabet letters and scrapes biographical details:
- Arabic Name & Translation
- Ibn Hajar Rank (الرتبة عند ابن حجر)
- Dhahabi Rank (الرتبة عند الذهبي)
- Teachers & Students (اساتذہ و تلامذہ)
Outputs canonical CSV to data/iub/rijal.csv.
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

OUT_FILE = os.path.join("data", "iub", "rijal.csv")
ID_CACHE_FILE = os.path.join("data", "iub_rijal_ids.json")
os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)

ARABIC_LETTERS = [
    'ا', 'ب', 'ت', 'ث', 'ج', 'ح', 'خ', 'د', 'ذ', 'ر', 'ز', 'س', 'ش',
    'ص', 'ض', 'ط', 'ظ', 'ع', 'غ', 'ف', 'ق', 'ك', 'ل', 'م', 'ن', 'و', 'ه', 'ي'
]

def discover_narrator_ids() -> list:
    if os.path.exists(ID_CACHE_FILE):
        try:
            with open(ID_CACHE_FILE, "r", encoding="utf-8") as f:
                ids = json.load(f)
                if ids and len(ids) > 1000:
                    print(f"Loaded {len(ids):,} narrator IDs from cache.", flush=True)
                    return ids
        except Exception:
            pass

    print("🔍 Discovering narrator IDs from alphabet index pages...", flush=True)
    all_ids = set()

    for letter in ARABIC_LETTERS:
        # URL encode letter
        import urllib.parse
        q_enc = urllib.parse.quote(letter)
        url = f"https://islamicurdubooks.com/hadith/hadith_narrators.php?q={q_enc}"
        html, _, _ = fetch_page(url, "rijal_index", f"letter_{letter}")
        if html:
            matches = re.findall(r'href=[\'"][^\'"]*rawyid=(\d+)[\'"]', html)
            for m in matches:
                all_ids.add(int(m))
        print(f"   Letter '{letter}': {len(matches)} narrators found (Total unique: {len(all_ids):,})", flush=True)
        time.sleep(0.2)

    sorted_ids = sorted(list(all_ids))
    with open(ID_CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(sorted_ids, f, indent=2)

    print(f"✅ Discovered {len(sorted_ids):,} total unique narrator IDs!\n", flush=True)
    return sorted_ids

def parse_narrator_page(rawyid: int) -> dict | None:
    url = f"https://islamicurdubooks.com/hadith/rawy-details.php?rawyid={rawyid}"
    html, is_missing, _ = fetch_page(url, "rijal", f"rawy_{rawyid}")
    if not html or is_missing:
        return None

    # Title & Arabic Name
    title_m = re.search(r'<title>([^<]+)</title>', html)
    raw_title = clean_html(title_m.group(1)) if title_m else f"راوی {rawyid}"
    
    # Extract name
    name_ar = ""
    name_m = re.search(r'class="[^"]*fontarabic fs7[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    if not name_m:
        name_m = re.search(r'class="[^"]*btn1[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    if name_m:
        name_ar = clean_html(name_m.group(1))
    if not name_ar:
        name_ar = raw_title.replace("رواۃ الحدیث:", "").strip()

    # Tables with details
    tables = re.findall(r'<table[^>]*>(.*?)</table>', html, re.DOTALL)
    details = []
    ibn_hajar_rank = ""
    dhahabi_rank = ""
    tabaqa = ""
    city = ""

    for tbl in tables:
        rows = re.findall(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>', tbl, re.DOTALL)
        for td1, td2 in rows:
            k = clean_html(td1)
            v = clean_html(td2)
            if k and v:
                details.append(f"{k}: {v}")
                if "ابن حجر" in k:
                    ibn_hajar_rank = v
                elif "الذهبي" in k or "ذہبی" in k:
                    dhahabi_rank = v
                elif "الطبقة" in k or "طبقہ" in k:
                    tabaqa = v
                elif "البلد" in k or "شہر" in k or "وطن" in k:
                    city = v

    # Narrative content
    content_div = re.search(r'class="[^"]*card-body[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    body_text = clean_html(content_div.group(1)) if content_div else ""

    full_content = f"راوی: {name_ar}\n\n" + "\n".join(details)
    if body_text and len(body_text) > len(full_content):
        full_content += f"\n\nتفصیل:\n{body_text}"

    citation_ref = {
        "discipline": "rijal",
        "rawy_id": rawyid,
        "name_ar": name_ar,
        "ibn_hajar_rank": ibn_hajar_rank,
        "dhahabi_rank": dhahabi_rank,
        "tabaqa": tabaqa,
        "city": city,
        "source": "islamicurdubooks.com",
        "url": url
    }

    return {
        "domain": "islamicurdubooks-rijal",
        "source_type": "narrator",
        "title": f"رواۃ الحدیث: {name_ar}",
        "content": full_content,
        "content_ar": None, # Kept NULL for narrators per execution plan D.1
        "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
        "language": "ur",
        "source_url": url,
        "passage_key": f"rijal:iub:{rawyid}"
    }

def scrape_all_narrators(max_workers: int = 4):
    ids = discover_narrator_ids()
    print(f"📖 Starting Narrators Scrape ({len(ids):,} total) -> {OUT_FILE}", flush=True)

    # Check existing
    existing_ids = set()
    if os.path.exists(OUT_FILE):
        with open(OUT_FILE, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f)
            for r in reader:
                try:
                    cit = json.loads(r.get("citation_ref") or "{}")
                    rid = cit.get("rawy_id")
                    if rid:
                        existing_ids.add(int(rid))
                except Exception:
                    pass
        print(f"Found existing {len(existing_ids):,} narrators. Resuming...", flush=True)

    pending_ids = [rid for rid in ids if rid not in existing_ids]
    if not pending_ids:
        print(f"✅ All {len(ids):,} narrators already scraped!", flush=True)
        return

    file_exists = os.path.exists(OUT_FILE) and os.path.getsize(OUT_FILE) > 0
    f_out = open(OUT_FILE, "a", encoding="utf-8", newline="")
    writer = csv.DictWriter(f_out, fieldnames=CSV_HEADERS)
    if not file_exists:
        writer.writeheader()
        f_out.flush()

    total = len(ids)
    scraped_count = len(existing_ids)
    t0 = time.time()

    batch_size = 50
    for i in range(0, len(pending_ids), batch_size):
        batch = pending_ids[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(parse_narrator_page, rid): rid for rid in batch}
            for f in as_completed(futures):
                row = f.result()
                if row:
                    writer.writerow(row)
                    scraped_count += 1

        f_out.flush()
        elapsed = max(1.0, time.time() - t0)
        rate = round(scraped_count / (elapsed / 60.0), 1)
        pct = round(scraped_count / total * 100, 1)
        print(f"   [Asma ur-Rijal] {scraped_count:,}/{total:,} ({pct}%) - ~{rate} narrators/min", flush=True)
        time.sleep(0.2)

    f_out.close()
    print(f"🎉 Narrators scraping complete! {scraped_count:,} rows saved to {OUT_FILE}", flush=True)

if __name__ == "__main__":
    scrape_all_narrators()
