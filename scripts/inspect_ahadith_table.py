import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

hadees_db_path = r"data\easyquran\EasyHadees.dat"

print("--- Inspecting Ahadith Table Schema & Samples for Book 16 and 17 ---")
db = AccessParser(hadees_db_path)
tbl_ahadith = db.parse_table("Ahadith")

cols = list(tbl_ahadith.keys())
print("Columns in Ahadith table:", cols)

num_rows = len(tbl_ahadith[cols[0]])
print(f"Total rows in Ahadith table: {num_rows:,}\n")

book_counts = {}
sample_b16 = None
sample_b17 = None

for i in range(num_rows):
    b_id = tbl_ahadith.get("Book", [None]*num_rows)[i]
    book_counts[b_id] = book_counts.get(b_id, 0) + 1
    
    if b_id == 16 and sample_b16 is None:
        sample_b16 = {c: tbl_ahadith[c][i] for c in cols}
    elif b_id == 17 and sample_b17 is None:
        sample_b17 = {c: tbl_ahadith[c][i] for c in cols}

print("Hadith count per Book ID:", book_counts)
print("\nSample row for Book 16 (طحاوی شریف):", sample_b16)
print("\nSample row for Book 17 (کنزالعمال):", sample_b17)
