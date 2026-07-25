import os
import sys
from access_parser import AccessParser

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db = AccessParser(r"data\easyquran\EasyQuran.dat")
hadees_db = AccessParser(r"data\easyquran\EasyHadees.dat")

print("--- EasyQuran.dat Tables ---")
for t in quran_db.catalog:
    if not t.startswith("MSys"):
        print(f"  {t}")

print("\n--- EasyHadees.dat Tables ---")
for t in hadees_db.catalog:
    if not t.startswith("MSys"):
        print(f"  {t}")
