"""
scrape_hadith.py - High-speed multi-threaded scraper for IslamicUrduBooks Hadith collections.
Scrapes the 12 new missing collections (or any selected book) and outputs canonical 9-column CSV:
  domain, source_type, title, content, content_ar, citation_ref, language, source_url, passage_key
Features:
- 4 concurrent workers per book with polite rate limiting.
- Gzipped disk cache at data/iub_cache/hadith/
- One CSV per book under data/iub/
- Progress checkpoints to data/iub_state.json
"""

import os
import sys
import csv
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.registry import IUB_REGISTRY
from scripts.iub.client import fetch_page, load_state, save_state

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUT_DIR = os.path.join("data", "iub")
os.makedirs(OUT_DIR, exist_ok=True)

CSV_HEADERS = [
    "domain", "source_type", "title", "content", "content_ar",
    "citation_ref", "language", "source_url", "passage_key"
]

def clean_html(text: str) -> str:
    if not text:
        return ""
    # Strip scripts and styles
    text = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)
    # Convert breaks and paragraphs to spaces/newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
    # Strip remaining tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Unescape HTML entities
    text = text.replace('&nbsp;', ' ').replace('&quot;', '"').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    # Collapse multiple spaces
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n', text)
    return text.strip()

def parse_hadith_page(html: str, path: str, bookid: int, hno: int, slug: str, book_title: str) -> dict | None:
    if not html:
        return None
    if "درست کتاب ID فراہم کریں" in html or "حدیث کا ریکارڈ نہیں ملا" in html:
        return None

    url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={hno}"

    # The site is inconsistent about quoting class="..." vs class='...' --
    # confirmed on cached pages: the id="tashkeel_..._with" wrapper for Arabic
    # matn uses double quotes, but the div.hadith_urdu translation wrapper uses
    # SINGLE quotes ("<div class='fonturdu fs2 hadith_urdu right'>"). A
    # double-quote-only regex silently matches zero Urdu translations on every
    # page -- content_ur was empty for all ~39k hadith rows scraped so far,
    # even though content_ar came through fine via the (double-quoted)
    # tashkeel_with wrapper. Every extraction below now accepts either quote
    # character.
    def _class_matches(class_name):
        return re.findall(
            r'class=["\']' + r'[^"\']*' + re.escape(class_name) + r'[^"\']*["\'][^>]*>(.*?)</div>',
            html, re.DOTALL,
        )

    # 1. Arabic Matn (with tashkeel)
    ar_matches = re.findall(r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>', html, re.DOTALL)
    if not ar_matches:
        ar_matches = _class_matches("hadith_arabic")

    content_ar = clean_html(" ".join(ar_matches)) if ar_matches else ""

    # 2. Urdu Translation
    ur_matches = _class_matches("hadith_urdu")
    content_ur = clean_html(" ".join(ur_matches)) if ur_matches else ""

    if not content_ur and not content_ar:
        return None

    # 3. Chapter / Bab
    bab_match = re.search(r'class="[^"]*bab_container[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    chapter_name = clean_html(bab_match.group(1)) if bab_match else ""
    if chapter_name.startswith("باب:"):
        chapter_name = chapter_name[4:].strip()

    # 4. Takhreej & Hukm / Grade
    takhreej_match = re.search(r'class="[^"]*takhreej_color[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    takhreej_text = clean_html(takhreej_match.group(1)) if takhreej_match else ""
    
    grade = ""
    hukm_match = re.search(r'الحكم على الحديث:\s*<span[^>]*class="[^"]*hukm_detail_color[^"]*"[^>]*>([^<]+)</span>', html)
    if hukm_match:
        grade = clean_html(hukm_match.group(1))
    elif "صحیح" in takhreej_text:
        grade = "صحیح"
    elif "ضعیف" in takhreej_text:
        grade = "ضعیف"
    elif "حسن" in takhreej_text:
        grade = "حسن"

    # 5. Narrators / Rawat
    narrators = []
    rows = re.findall(r'<tr[^>]*>\s*<td[^>]*>(.*?)</td>\s*<td[^>]*>(.*?)</td>', html, re.DOTALL)
    for td1, td2 in rows:
        name = clean_html(td1)
        rank = clean_html(td2)
        if name and rank and "راوی" not in name and "الرتبة" not in rank:
            narrators.append({"name": name, "rank": rank})

    title = f"{book_title} - حدیث {hno}"
    
    # Structure full Urdu text block
    content_parts = []
    if chapter_name:
        content_parts.append(f"باب: {chapter_name}")
    if content_ur:
        content_parts.append(content_ur)
    if grade:
        content_parts.append(f"حکم: {grade}")
    if takhreej_text:
        content_parts.append(f"تخریج: {takhreej_text}")
        
    full_content = "\n\n".join(content_parts) if content_parts else (content_ar or title)

    citation_ref = {
        "discipline": "hadith",
        "book": book_title,
        "collection": slug,
        "hadith_number": hno,
        "chapter": chapter_name,
        "grade": grade,
        "source": "islamicurdubooks.com",
        "url": url,
        "narrators": narrators[:10]  # Cap to first 10 narrators
    }

    return {
        "domain": "islamicurdubooks-hadith",
        "source_type": "hadith",
        "title": title,
        "content": full_content,
        "content_ar": content_ar,
        "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
        "language": "ur",
        "source_url": url,
        "passage_key": f"hadith:iub:{slug}:{hno}"
    }

def scrape_collection(path: str, bookid: int, info: dict, max_workers: int = 4):
    slug = info["slug"]
    book_title = info["arabic_title"]
    total = info["iub_total"]
    
    csv_file = os.path.join(OUT_DIR, f"{slug}.csv")
    print(f"\n==========================================", flush=True)
    print(f"📖 Starting Scrape: {book_title} ({slug}) | Expected Hadiths: {total:,}", flush=True)
    print(f"   Destination: {csv_file}", flush=True)
    print(f"==========================================", flush=True)

    # Load existing scraped numbers if resuming
    existing_hnums = set()
    if os.path.exists(csv_file):
        with open(csv_file, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.DictReader(f)
            for r in reader:
                try:
                    cit = json.loads(r.get("citation_ref") or "{}")
                    hno = cit.get("hadith_number")
                    if hno:
                        existing_hnums.add(int(hno))
                except Exception:
                    pass
        print(f"   Found existing {len(existing_hnums):,} rows in CSV. Resuming...", flush=True)

    pending_hnums = [n for n in range(1, total + 1) if n not in existing_hnums]
    if not pending_hnums:
        print(f"   ✅ All {total:,} hadiths already scraped in {csv_file}!", flush=True)
        return total

    # Open CSV in append mode
    file_exists = os.path.exists(csv_file) and os.path.getsize(csv_file) > 0
    f_out = open(csv_file, "a", encoding="utf-8", newline="")
    writer = csv.DictWriter(f_out, fieldnames=CSV_HEADERS)
    if not file_exists:
        writer.writeheader()
        f_out.flush()

    scraped_count = len(existing_hnums)
    t0 = time.time()

    def fetch_and_parse(hno):
        url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={hno}"
        html, is_missing, err = fetch_page(url, module=f"hadith_{slug}", key=f"{slug}_{hno}")
        if is_missing or not html:
            return hno, None
        row = parse_hadith_page(html, path, bookid, hno, slug, book_title)
        return hno, row

    # Scrape in batches with ThreadPoolExecutor
    batch_size = 50
    for i in range(0, len(pending_hnums), batch_size):
        batch = pending_hnums[i:i + batch_size]
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(fetch_and_parse, hno): hno for hno in batch}
            for f in as_completed(futures):
                hno, row = f.result()
                if row:
                    writer.writerow(row)
                    scraped_count += 1
                    
        f_out.flush()
        elapsed = max(1.0, time.time() - t0)
        rate = round(scraped_count / (elapsed / 60.0), 1)
        pct = round(scraped_count / total * 100, 1)
        print(f"   [{book_title}] {scraped_count:,}/{total:,} ({pct}%) - ~{rate} hadiths/min", flush=True)
        time.sleep(0.3)

    f_out.close()
    print(f"   ✅ Finished {book_title}: {scraped_count:,}/{total:,} rows written to {csv_file}\n", flush=True)
    return scraped_count

# fath-al-rabbani is a topical re-arrangement of Musnad Ahmad, which is already
# in the corpus at 27,647 rows. It was scraped and loaded before that was caught,
# and the decision was to keep what landed but exclude it from the vector space
# (see SKIP_COLLECTION in supabase/functions/backfill-embeddings). Fetching its
# remaining ~1,587 rows would spend budget on content that is redundant by that
# same decision and will never be embedded -- so it is skipped by default.
# Set IUB_INCLUDE_FATH=1 to pull it to completion anyway.
SKIP_UNLESS_ASKED = {"fath-al-rabbani"}


def main():
    include_fath = os.environ.get("IUB_INCLUDE_FATH") == "1"
    target_books = [
        k for k, v in IUB_REGISTRY.items()
        if v["is_new"] and (include_fath or v["slug"] not in SKIP_UNLESS_ASKED)
    ]
    skipped = [v["slug"] for v in IUB_REGISTRY.values()
               if v["is_new"] and not include_fath and v["slug"] in SKIP_UNLESS_ASKED]
    if skipped:
        print(f"Skipping (set IUB_INCLUDE_FATH=1 to include): {', '.join(skipped)}", flush=True)
    print(f"=== Starting Ingestion Wave for {len(target_books)} Missing Hadith Books ===\n", flush=True)
    
    total_scraped = 0
    for key in target_books:
        info = IUB_REGISTRY[key]
        count = scrape_collection(key[0], key[1], info, max_workers=4)
        total_scraped += count

    print(f"\n🎉 ALL {len(target_books)} COLLECTIONS SCRAPED! Grand Total: {total_scraped:,} rows.", flush=True)

if __name__ == "__main__":
    main()
