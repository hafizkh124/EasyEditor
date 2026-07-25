import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db_path = r"data\easyquran\EasyQuran.dat"
hadees_db_path = r"data\easyquran\EasyHadees.dat"

def print_tables(filepath, label):
    print(f"\n================ {label} Table Catalog ================")
    db = AccessParser(filepath)
    tables = db.catalog
    for tname in tables:
        print(f"  - Table: {tname}")
        
print_tables(quran_db_path, "EasyQuran.dat")
print_tables(hadees_db_path, "EasyHadees.dat")
