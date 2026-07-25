import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db_path = r"data\easyquran\EasyQuran.dat"

print("================ EasyQuran.dat Table Catalog ================")
db = AccessParser(quran_db_path)
for tname in db.catalog:
    print(f"  - Table: {tname}")
    try:
        tbl = db.parse_table(tname)
        cols = list(tbl.keys())
        cnt = len(tbl[cols[0]]) if cols else 0
        print(f"    Rows: {cnt:,} | Columns: {cols}")
    except Exception as e:
        print(f"    Error: {e}")
