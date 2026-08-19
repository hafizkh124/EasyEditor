"""
scrape_misc.py - Scrapes Masnoon Duain and Hadith Terminology (Istalahat) from IslamicUrduBooks.
Outputs canonical CSV to data/iub/misc.csv.
"""

import os
import sys
import csv
import json
import re
import urllib.request
import ssl

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.client import fetch_page
from scripts.iub.scrape_hadith import clean_html, CSV_HEADERS

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OUT_FILE = os.path.join("data", "iub", "misc.csv")
os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)

def harvest_istilahat_ids() -> list:
    url = "https://islamicurdubooks.com/istalahat_hadith.php"
    html, _, _ = fetch_page(url, "misc", "istalahat_index")
    if not html:
        return []
    matches = re.findall(r'href=[\'"][^\'"]*bsc_id=(\d+)[\'"]', html)
    return sorted(list(set([int(m) for m in matches])))

def parse_istilah_page(bsc_id: int) -> dict | None:
    url = f"https://islamicurdubooks.com/info/info-detail-short.php?bsc_id={bsc_id}"
    html, is_missing, _ = fetch_page(url, "misc", f"istilah_{bsc_id}")
    if not html or is_missing:
        return None

    # Title
    t_match = re.search(r'class="[^"]*btn1[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    title = clean_html(t_match.group(1)) if t_match else f"اصطلاح حدیث {bsc_id}"
    if title.startswith("اصطلاحاتِ حدیث:"):
        title = title[15:].strip()

    # Content
    body_match = re.search(r'class="[^"]*card-body[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    content = clean_html(body_match.group(1)) if body_match else ""
    if not content or len(content) < 20:
        return None

    citation_ref = {
        "discipline": "hadith_term",
        "category": "اصطلاحاتِ حدیث",
        "term_id": bsc_id,
        "title": title,
        "source": "islamicurdubooks.com",
        "url": url
    }

    return {
        "domain": "islamicurdubooks-misc",
        "source_type": "article",
        "title": f"اصطلاحاتِ حدیث: {title}",
        "content": f"اصطلاحاتِ حدیث: {title}\n\n{content}",
        "content_ar": None,
        "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
        "language": "ur",
        "source_url": url,
        "passage_key": f"istilah:iub:{bsc_id}"
    }

def harvest_dua_ids() -> list:
    url = "https://islamicurdubooks.com/dua/index.php"
    html, _, _ = fetch_page(url, "misc", "dua_index")
    if not html:
        return []
    matches = re.findall(r'href=[\'"][^\'"]*dua-detail\.php\?id=(\d+)[\'"]', html)
    return sorted(list(set([int(m) for m in matches])))

def parse_dua_page(dua_id: int) -> dict | None:
    url = f"https://islamicurdubooks.com/dua/dua-detail.php?id={dua_id}"
    html, is_missing, _ = fetch_page(url, "misc", f"dua_{dua_id}")
    if not html or is_missing:
        return None

    # Title
    t_match = re.search(r'class="[^"]*btn1[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    title = clean_html(t_match.group(1)) if t_match else f"مسنون دعا {dua_id}"

    # Arabic
    ar_match = re.search(r'class="[^"]*fontarabic[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    content_ar = clean_html(ar_match.group(1)) if ar_match else ""

    # Urdu & Takhreej
    body_match = re.search(r'class="[^"]*card-body[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    content_ur = clean_html(body_match.group(1)) if body_match else ""

    if not content_ur and not content_ar:
        return None

    citation_ref = {
        "discipline": "dua",
        "category": "مسنون دعائیں",
        "dua_id": dua_id,
        "title": title,
        "source": "islamicurdubooks.com",
        "url": url
    }

    full_content = f"مسنون دعا: {title}\n\nعربی: {content_ar}\n\nاردو ترجمہ و تفصیل:\n{content_ur}"

    return {
        "domain": "islamicurdubooks-misc",
        "source_type": "article",
        "title": f"مسنون دعا: {title}",
        "content": full_content,
        "content_ar": content_ar or None,
        "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
        "language": "ur",
        "source_url": url,
        "passage_key": f"dua:iub:{dua_id}"
    }

def main():
    print("=== Scraping Duas and Hadith Terminology (Misc) ===", flush=True)
    rows = []

    # 1. Istilahat
    ist_ids = harvest_istilahat_ids()
    print(f"Found {len(ist_ids)} Hadith Terminology IDs...", flush=True)
    for bsc_id in ist_ids:
        r = parse_istilah_page(bsc_id)
        if r:
            rows.append(r)

    # 2. Duas
    dua_ids = harvest_dua_ids()
    print(f"Found {len(dua_ids)} Dua IDs...", flush=True)
    for dua_id in dua_ids:
        r = parse_dua_page(dua_id)
        if r:
            rows.append(r)

    print(f"Total valid misc rows: {len(rows)}")
    with open(OUT_FILE, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"✅ Saved {len(rows)} rows to {OUT_FILE}", flush=True)

if __name__ == "__main__":
    main()
