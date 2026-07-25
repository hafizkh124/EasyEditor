import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

hadees_db_path = r"data\easyquran\EasyHadees.dat"

print("================ EasyHadees.dat Table Catalog ================")
db = AccessParser(hadees_db_path)
for tname in db.catalog:
    print(f"  - Table: {tname}")
    try:
        tbl = db.parse_table(tname)
        cols = list(tbl.keys())
        cnt = len(tbl[cols[0]]) if cols else 0
        print(f"    Rows: {cnt:,} | Columns: {cols}")
        
        if any(k in tname.lower() for k in ["book", "hadees", "hadith", "author", "tarjuma", "tafsir", "name", "title"]):
            for c in cols[:4]:
                sample = tbl[c][:5]
                print(f"      Sample [{c}]: {sample}")
    except Exception as e:
        print(f"    Error: {e}")
