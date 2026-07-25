import os
import sys
import pyodbc

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db = os.path.abspath(r"data\easyquran\EasyQuran.dat")
hadees_db = os.path.abspath(r"data\easyquran\EasyHadees.dat")

def inspect_with_pyodbc(db_path, name):
    print(f"\n================ Inspecting {name} ================")
    conn_str = rf"Driver={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={db_path};"
    try:
        conn = pyodbc.connect(conn_str)
        cursor = conn.cursor()
        
        tables = [row.table_name for row in cursor.tables(tableType='TABLE')]
        print(f"Total Tables in {name}: {len(tables)}")
        
        for tname in tables:
            try:
                cursor.execute(f"SELECT COUNT(*) FROM [{tname}]")
                cnt = cursor.fetchone()[0]
                cursor.execute(f"SELECT TOP 1 * FROM [{tname}]")
                col_names = [column[0] for column in cursor.description]
                print(f"  Table [{tname}]: {cnt:,} rows | Columns: {col_names}")
            except Exception as e:
                print(f"  Table [{tname}] error: {e}")
                
        conn.close()
    except Exception as e:
        print(f"pyodbc connection error for {name}: {e}")

inspect_with_pyodbc(quran_db, "EasyQuran.dat")
inspect_with_pyodbc(hadees_db, "EasyHadees.dat")
