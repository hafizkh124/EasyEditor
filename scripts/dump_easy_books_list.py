import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db_path = r"data\easyquran\EasyQuran.dat"
hadees_db_path = r"data\easyquran\EasyHadees.dat"

print("================ Books in EasyHadees.dat ================")
db_h = AccessParser(hadees_db_path)
tbl_books = db_h.parse_table("Books")

cols = list(tbl_books.keys())
print("Columns in Books table:", cols)

num_books = len(tbl_books[cols[0]])
print(f"Total Books found: {num_books}\n")

for i in range(num_books):
    row_dict = {col: tbl_books[col][i] for col in cols}
    print(f"Book [{i+1}]: {row_dict}")

print("\n================ Intros & Tafseers in EasyQuran.dat ================")
db_q = AccessParser(quran_db_path)
tbl_intro = db_q.parse_table("Intro")
cols_q = list(tbl_intro.keys())
print("Columns in Intro table:", cols_q)
print("Sample Intro rows:", len(tbl_intro[cols_q[0]]))
for i in range(min(15, len(tbl_intro[cols_q[0]]))):
    row_q = {col: tbl_intro[col][i] for col in cols_q}
    print(f"  Intro [{i+1}]: {row_q}")
