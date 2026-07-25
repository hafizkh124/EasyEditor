import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db = AccessParser(r"data\easyquran\EasyQuran.dat")
tbl = quran_db.parse_table("Ayat")
cols = list(tbl.keys())
print("EasyQuran -> Ayat Columns:", cols)
num_rows = len(tbl[cols[0]])
print(f"Total Ayat rows: {num_rows:,}")
for c in cols:
    val = str(tbl[c][0])[:60]
    print(f"  {c}: {val}")
