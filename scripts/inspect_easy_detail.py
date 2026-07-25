import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db_path = r"data\easyquran\EasyQuran.dat"
hadees_db_path = r"data\easyquran\EasyHadees.dat"

print("--- Inspecting EasyQuran.dat Intro / Tafseer rows ---")
db_q = AccessParser(quran_db_path)
if "Intro" in db_q.catalog:
    tbl = db_q.parse_table("Intro")
    cols = list(tbl.keys())
    for i in range(len(tbl[cols[0]])):
        row = {c: tbl[c][i] for c in cols}
        print(f"Intro [{i+1}]: {row}")

print("\n--- Inspecting EasyHadees.dat Intro / Tafseer / Book rows ---")
db_h = AccessParser(hadees_db_path)
if "Intro" in db_h.catalog:
    tbl_h = db_h.parse_table("Intro")
    cols_h = list(tbl_h.keys())
    for i in range(len(tbl_h[cols_h[0]])):
        row = {c: tbl_h[c][i] for c in cols_h}
        print(f"Hadees Intro [{i+1}]: {row}")

print("\n--- Inspecting Books in EasyHadees.dat ---")
tbl_b = db_h.parse_table("Books")
cols_b = list(tbl_b.keys())
for i in range(len(tbl_b[cols_b[0]])):
    print(f"Book [{i+1}]: ID={tbl_b['Id'][i]}, Title={tbl_b['Title'][i]}")
