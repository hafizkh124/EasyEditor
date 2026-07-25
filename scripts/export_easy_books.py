import os
import sys
import json
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

hadees_db_path = r"data\easyquran\EasyHadees.dat"
out_json = r"data\easyquran\books_catalog.json"

print("Parsing Books table from EasyHadees.dat...")
db = AccessParser(hadees_db_path)
tbl_books = db.parse_table("Books")

cols = list(tbl_books.keys())
num_rows = len(tbl_books[cols[0]])

books_list = []
for i in range(num_rows):
    row_dict = {col: str(tbl_books[col][i]) for col in cols}
    books_list.append(row_dict)

with open(out_json, "w", encoding="utf-8") as f:
    json.dump(books_list, f, ensure_ascii=False, indent=2)

print(f"Exported {len(books_list)} books to {out_json}")
