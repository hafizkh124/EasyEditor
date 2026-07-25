import os
import sys
import pyodbc

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db = os.path.abspath(r"data\easyquran\EasyQuran.dat")
hadees_db = os.path.abspath(r"data\easyquran\EasyHadees.dat")

passwords = [
    "", "123456", "123", "admin", "easyquran", "easy", "eqwh", "quran", "hadees", "adf",
    "easyquranwahadees", "Eqwh", "EasyQuran", "EasyHadees", "12345678", "password"
]

for pwd in passwords:
    conn_str = rf"Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={quran_db};PWD={pwd};"
    try:
        conn = pyodbc.connect(conn_str)
        print(f"SUCCESS! Found password for EasyQuran.dat: '{pwd}'")
        cursor = conn.cursor()
        tables = [row.table_name for row in cursor.tables(tableType='TABLE')]
        print("Tables:", tables)
        conn.close()
        break
    except Exception:
        pass

for pwd in passwords:
    conn_str = rf"Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={hadees_db};PWD={pwd};"
    try:
        conn = pyodbc.connect(conn_str)
        print(f"SUCCESS! Found password for EasyHadees.dat: '{pwd}'")
        cursor = conn.cursor()
        tables = [row.table_name for row in cursor.tables(tableType='TABLE')]
        print("Tables:", tables)
        conn.close()
        break
    except Exception:
        pass
