import csv
import json
import sys
import os
sys.path.insert(0, os.path.abspath("."))
from scripts.iub.client import fetch_page
from scripts.iub.probe_alignment import extract_arabic_from_html
from scripts.iub.ar_normalize import normalize_arabic_text, ar_fingerprint

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Let's inspect Ibn Hibban hadith #1 in tohed_hadiths.csv
with open("data/tohed_hadiths.csv", "r", encoding="utf-8", errors="ignore") as f:
    reader = csv.DictReader(f)
    for row in reader:
        cit = json.loads(row.get("citation_ref") or "{}")
        if cit.get("collection") == "sahih-ibn-hibban" and str(cit.get("hadith_number")) == "1":
            print("=== DB Row for Ibn Hibban 1 ===")
            print("Title:", row.get("title"))
            print("Content_AR:", row.get("content_ar")[:200])
            print("DB Norm AR:", normalize_arabic_text(row.get("content_ar"))[:200])
            print("DB FP:", ar_fingerprint(row.get("content_ar")))
            break

# Now fetch Ibn Hibban 1 from IUB
html, _, _ = fetch_page("https://islamicurdubooks.com/hadith/hadith-.php?bookid=37&hadith_number=1", "probe", "hibban_1")
iub_ar = extract_arabic_from_html(html)
print("\n=== IUB Page for Ibn Hibban 1 ===")
print("IUB Content_AR:", iub_ar[:200])
print("IUB Norm AR:", normalize_arabic_text(iub_ar)[:200])
print("IUB FP:", ar_fingerprint(iub_ar))
