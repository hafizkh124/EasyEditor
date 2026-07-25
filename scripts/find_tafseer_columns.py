import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db = AccessParser(r"data\easyquran\EasyQuran.dat")
tbl_ayat = quran_db.parse_table("Ayat")
cols = list(tbl_ayat.keys())
print("Columns in EasyQuran.dat -> Ayat table:", cols)

print("\n--- Sample row 1 in EasyQuran.dat -> Ayat ---")
num_rows = len(tbl_ayat[cols[0]])
for c in cols:
    val = str(tbl_ayat[c][0])[:100]
    print(f"  {c}: {val}")

if "Intro" in quran_db.catalog:
    tbl_intro = quran_db.parse_table("Intro")
    cols_intro = list(tbl_intro.keys())
    print("\n--- Intro table categories & captions ---")
    for i in range(len(tbl_intro[cols_intro[0]])):
        cid = tbl_intro.get("Id", [None]*100)[i]
        cat = tbl_intro.get("Category", [None]*100)[i]
        cap = tbl_intro.get("Caption", [None]*100)[i]
        print(f"  ID: {cid} | Cat: {cat} | Caption: {cap}")
