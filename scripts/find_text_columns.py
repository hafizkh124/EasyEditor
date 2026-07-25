import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

hadees_db_path = r"data\easyquran\EasyHadees.dat"

print("--- Searching for text columns across all tables in EasyHadees.dat ---")
db = AccessParser(hadees_db_path)

for tname in db.catalog:
    if tname.startswith("MSys") or tname.startswith("f_"):
        continue
    try:
        tbl = db.parse_table(tname)
        cols = list(tbl.keys())
        num_rows = len(tbl[cols[0]]) if cols else 0
        text_cols = []
        for c in cols:
            val = str(tbl[c][0]) if num_rows > 0 else ""
            if len(val) > 20 or any(kw in c.lower() for kw in ["text", "content", "tarjuma", "arabic", "urdu", "hadith", "matn", "sharh"]):
                text_cols.append(c)
        if text_cols:
            print(f"Table [{tname}] ({num_rows:,} rows) -> Text Columns: {text_cols}")
            for tc in text_cols[:3]:
                sample = str(tbl[tc][0])[:80] if num_rows > 0 else ""
                print(f"   Sample [{tc}]: {sample}...")
    except Exception as e:
        print(f"Error checking {tname}: {e}")
