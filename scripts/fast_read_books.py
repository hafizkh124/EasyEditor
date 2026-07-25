import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

db = AccessParser(r"data\easyquran\EasyHadees.dat")
tbl = db.parse_table("Books")
cols = list(tbl.keys())

out_file = r"data\easyquran\books_list.txt"
with open(out_file, "w", encoding="utf-8") as f:
    f.write(f"Total Books: {len(tbl[cols[0]])}\n\n")
    for i in range(len(tbl[cols[0]])):
        row_str = " | ".join([f"{c}: {tbl[c][i]}" for c in cols])
        f.write(f"{i+1}. {row_str}\n")

print(f"Wrote books list to {out_file}")
