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


def _class_match(html, class_name):
    """Match a div's content by class name, tolerating both quote styles.
    See the same fix in scrape_hadith.py -- this site mixes class="..." and
    class='...' across pages, and a quote-specific regex silently matches
    nothing on whichever style the page happens to use."""
    m = re.search(
        r'class=["\']' + r'[^"\']*' + re.escape(class_name) + r'[^"\']*["\'][^>]*>(.*?)</div>',
        html, re.DOTALL,
    )
    return m.group(1) if m else None

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

    # Real page structure (confirmed against cached pages -- there is no
    # "card-body" or usefully-titled "btn1" content here; that pattern only
    # matched the site's generic nav button, which is why every row
    # previously came out empty or titled "اصطلاحاتِ حدیث" for all 66 terms):
    #   bab_container            -> the CATEGORY the term belongs to
    #   btnryellow fonturdu fs2  -> the TERM name itself (single-quoted)
    #   fonturdu fs2 lhp8 right  -> the definition text (single-quoted)
    category_raw = _class_match(html, "babblue")
    category = clean_html(category_raw) if category_raw else ""

    term_raw = _class_match(html, "btnryellow")
    term = clean_html(term_raw).rstrip(":،؛ ").strip() if term_raw else ""

    definition_raw = _class_match(html, "lhp8 right")
    definition = clean_html(definition_raw) if definition_raw else ""

    if not term or not definition or len(definition) < 5:
        return None

    title = term

    citation_ref = {
        "discipline": "hadith_term",
        "category": category or "اصطلاحاتِ حدیث",
        "term_id": bsc_id,
        "title": title,
        "source": "islamicurdubooks.com",
        "url": url
    }

    content_parts = [f"اصطلاحاتِ حدیث: {title}"]
    if category:
        content_parts.append(f"زمرہ: {category}")
    content_parts.append(definition)

    return {
        "domain": "islamicurdubooks-misc",
        "source_type": "article",
        "title": f"اصطلاحاتِ حدیث: {title}",
        "content": "\n\n".join(content_parts),
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
    # NOTE: every one of the 13 IDs listed on dua/index.php (2-14; id=1 does
    # not exist -- fetching it returns a 30-byte blank response) was checked
    # against its cached page and is an AUDIO recitation entry ("Sheikh
    # <reciter> (N)", "Takbeerat") with an <iframe> embed and no dua text on
    # the page at all -- confirmed both on the detail pages and on the
    # index page's own link labels. This is not a parsing gap: the module is
    # an audio playlist, not a text reference. The actual du'a TEXT corpus is
    # already ingested separately as the `hisn-al-muslim` hadith collection
    # (276 rows, bookid=19). The plan's own instruction -- "drop any row with
    # no Urdu/Arabic body" -- correctly yields zero rows here once the
    # extraction isn't fooled by matching the generic nav button as if it
    # were content (see the bug this replaces, which is why the old version
    # produced 13 garbage rows titled "دعا سیکشن" instead of zero).
    url = f"https://islamicurdubooks.com/dua/dua-detail.php?id={dua_id}"
    html, is_missing, _ = fetch_page(url, "misc", f"dua_{dua_id}")
    if not html or is_missing:
        return None

    title_raw = _class_match(html, "babblue")
    title = clean_html(title_raw) if title_raw else f"مسنون دعا {dua_id}"

    content_ar = clean_html(_class_match(html, "hadith_arabic") or "")
    content_ur = clean_html(_class_match(html, "hadith_urdu") or "")

    # The audio widget wraps its player in the SAME "hadith_urdu" class the
    # real translation divs elsewhere on the site use, with a fixed intro
    # caption as the only text ("آئیے اردو ترجمہ کے ساتھ دعائیں یاد کریں۔").
    # That caption is template boilerplate, not dua content -- and every
    # audio-only page also carries an <iframe> embed, so use that as the
    # confirming signal rather than string-matching the caption alone.
    if "<iframe" in html and len(content_ur) < 80 and not content_ar:
        return None

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
