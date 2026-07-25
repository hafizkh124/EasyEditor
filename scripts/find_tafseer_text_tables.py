import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db = AccessParser(r"data\easyquran\EasyQuran.dat")
hadees_db = AccessParser(r"data\easyquran\EasyHadees.dat")

print("=== EasyQuran.dat Table Search ===")
for tname in quran_db.catalog:
    if tname.startswith("MSys") or tname.startswith("f_"):
        continue
    tbl = quran_db.parse_table(tname)
    cols = list(tbl.keys())
    cnt = len(tbl[cols[0]]) if cols else 0
    print(f"Table [{tname}]: {cnt:,} rows | Columns: {cols}")

print("\n=== EasyHadees.dat Table Search ===")
for tname in hadees_db.catalog:
    if tname.startswith("MSys") or tname.startswith("f_") or tname in ["Ahadith", "ACDR", "HadithRavi", "RaviAhadithACD", "Repetition", "TopicsAhadithACD"]:
        continue
    tbl = hadees_db.parse_table(tname)
    cols = list(tbl.keys())
    cnt = len(tbl[cols[0]]) if cols else 0
    print(f"Table [{tname}]: {cnt:,} rows | Columns: {cols}")
