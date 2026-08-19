import gzip
import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

with gzip.open("data/iub_cache/probe/bukhari_1.html.gz", "rt", encoding="utf-8") as f:
    html = f.read()

# Find all divs with hadith_arabic
divs = re.findall(r'<div[^>]*class="[^"]*hadith_arabic[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
print(f"Total hadith_arabic divs in bukhari_1: {len(divs)}")
for i, d in enumerate(divs):
    clean = re.sub(r'<[^>]+>', ' ', d).strip()
    print(f"--- Div {i+1} ---")
    print(clean[:300])
    print()

# Also let's fetch bukhari_2
from scripts.iub.client import fetch_page
html2, _, _ = fetch_page("https://islamicurdubooks.com/hadith/hadith-.php?bookid=1&hadith_number=2", "probe", "bukhari_2")
divs2 = re.findall(r'<div[^>]*class="[^"]*hadith_arabic[^"]*"[^>]*>(.*?)</div>', html2, re.DOTALL)
print(f"Total hadith_arabic divs in bukhari_2: {len(divs2)}")
for i, d in enumerate(divs2):
    clean = re.sub(r'<[^>]+>', ' ', d).strip()
    print(f"--- Bukhari 2 Div {i+1} ---")
    print(clean[:300])
    print()
