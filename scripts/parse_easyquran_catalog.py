import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db_path = r"data\easyquran\EasyQuran.dat"
hadees_db_path = r"data\easyquran\EasyHadees.dat"

print("--- Parsing EasyQuran.dat catalog ---")
try:
    quran_db = AccessParser(quran_db_path)
    q_tables = quran_db.catalog
    print("Tables in EasyQuran.dat:", list(q_tables.keys()))
    
    for tname in q_tables.keys():
        try:
            tbl_data = quran_db.parse_table(tname)
            cols = list(tbl_data.keys()) if tbl_data else []
            row_cnt = len(tbl_data[cols[0]]) if cols else 0
            print(f"  Table '{tname}': {row_cnt:,} rows, Columns: {cols[:8]}")
        except Exception as e:
            print(f"  Table '{tname}' error: {e}")
except Exception as e:
    print(f"EasyQuran.dat parse error: {e}")

print("\n--- Parsing EasyHadees.dat catalog ---")
try:
    hadees_db = AccessParser(hadees_db_path)
    h_tables = hadees_db.catalog
    print("Tables in EasyHadees.dat:", list(h_tables.keys()))
    
    for tname in h_tables.keys():
        try:
            tbl_data = hadees_db.parse_table(tname)
            cols = list(tbl_data.keys()) if tbl_data else []
            row_cnt = len(tbl_data[cols[0]]) if cols else 0
            print(f"  Table '{tname}': {row_cnt:,} rows, Columns: {cols[:8]}")
        except Exception as e:
            print(f"  Table '{tname}' error: {e}")
except Exception as e:
    print(f"EasyHadees.dat parse error: {e}")
