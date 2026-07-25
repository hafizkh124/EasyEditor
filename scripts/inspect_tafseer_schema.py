import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db_path = r"data\easyquran\EasyQuran.dat"
hadees_db_path = r"data\easyquran\EasyHadees.dat"

db_q = AccessParser(quran_db_path)
print("=== EasyQuran.dat Tables & Columns ===")
for tname in db_q.catalog:
    if tname in ["Ayat", "Intro", "QTopics", "TopicAyat", "AQCustomSearch"]:
        try:
            tbl = db_q.parse_table(tname)
            cols = list(tbl.keys())
            print(f"Table [{tname}]: {len(tbl[cols[0]]):,} rows | Columns: {cols}")
            if cols:
                print("  Sample row 1:", {c: tbl[c][0] for c in cols[:6]})
        except Exception as e:
            print(f"Error parsing {tname}: {e}")

db_h = AccessParser(hadees_db_path)
print("\n=== EasyHadees.dat Tables & Columns ===")
for tname in db_h.catalog:
    if tname in ["Ahadith", "Books", "HadithKind", "Kinds", "Intro"]:
        try:
            tbl = db_h.parse_table(tname)
            cols = list(tbl.keys())
            print(f"Table [{tname}]: {len(tbl[cols[0]]):,} rows | Columns: {cols}")
            if cols:
                print("  Sample row 1:", {c: tbl[c][0] for c in cols[:6]})
        except Exception as e:
            print(f"Error parsing {tname}: {e}")
