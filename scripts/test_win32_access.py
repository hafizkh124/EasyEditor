import os
import sys
import win32com.client

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

quran_db = os.path.abspath(r"data\easyquran\EasyQuran.dat")
hadees_db = os.path.abspath(r"data\easyquran\EasyHadees.dat")

conn_str = f"Provider=Microsoft.Jet.OLEDB.4.0;Data Source={quran_db};"

try:
    conn = win32com.client.Dispatch("ADODB.Connection")
    conn.Open(conn_str)
    print("Successfully connected to EasyQuran.dat via ADODB Jet OLEDB 4.0!")
    
    rs = conn.OpenSchema(20) # adSchemaTables
    tables = []
    while not rs.EOF:
        tname = rs.Fields("TABLE_NAME").Value
        ttype = rs.Fields("TABLE_TYPE").Value
        if ttype == "TABLE":
            tables.append(tname)
        rs.MoveNext()
    print("Tables in EasyQuran.dat:", tables)
    conn.Close()
except Exception as e:
    print(f"ADODB error: {e}")
