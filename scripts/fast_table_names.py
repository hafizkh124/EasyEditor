import os
import sys
import re

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

hadees_db = r"data\easyquran\EasyHadees.dat"

print("--- Fast Table Name Scanner for EasyHadees.dat ---")
with open(hadees_db, "rb") as f:
    # Read first 10MB to find table definitions
    content = f.read(10 * 1024 * 1024)

# Find strings matching table names
matches = re.findall(rb'([A-Za-z0-9_]{3,40})\x00', content)
table_candidates = set()
for m in matches:
    try:
        s = m.decode('ascii')
        if any(kw in s.lower() for kw in ['hadees', 'hadith', 'tafsir', 'tarjuma', 'book', 'ayat', 'surah', 'bukhari', 'muslim', 'tirmizi', 'abudaud', 'nasai', 'ibnmajah', 'muwatta', 'usmani', 'bhatwi', 'yousaf', 'kelani', 'aq', 'tbl', 'data']):
            table_candidates.add(s)
    except Exception:
        pass

print("Discovered Tables & Datasets in EasyHadees.dat:")
for t in sorted(table_candidates):
    print("  -", t)
