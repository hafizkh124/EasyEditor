import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db_path = r"data\easyquran\EasyQuran.dat"
hadees_db_path = r"data\easyquran\EasyHadees.dat"

def parse_db(db_path, label):
    print(f"\n================ Catalog of {label} ================")
    try:
        db = AccessParser(db_path)
        tables = db.catalog
        print(f"Total Tables in {label}: {len(tables)}")
        for tname in tables.keys():
            print(f"  Table: {tname}")
            try:
                tbl = db.parse_table(tname)
                cols = list(tbl.keys())
                num_rows = len(tbl[cols[0]]) if cols else 0
                print(f"    Rows: {num_rows:,} | Columns: {cols}")
                
                # If table contains metadata/books list, let's print sample values!
                if any(k in tname.lower() for k in ["book", "tafsir", "trans", "author", "name", "list", "cat", "item"]):
                    for col in cols[:3]:
                        vals = tbl[col][:10]
                        print(f"    Sample {col}: {vals}")
            except Exception as ex:
                print(f"    Error parsing table {tname}: {ex}")
    except Exception as e:
        print(f"Error opening {label}: {e}")

parse_db(quran_db_path, "EasyQuran.dat")
parse_db(hadees_db_path, "EasyHadees.dat")
