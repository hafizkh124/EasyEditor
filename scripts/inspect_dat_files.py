import os
import sys
import zipfile
import sqlite3

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

zip_path = r"C:\Users\hafiz\Downloads\adf.zip"
out_dir = r"data\easyquran"
os.makedirs(out_dir, exist_ok=True)

print("Extracting EasyQuran.dat and EasyHadees.dat...")
with zipfile.ZipFile(zip_path, 'r') as z:
    for name in ["EasyQuran.dat", "EasyHadees.dat"]:
        if name in z.namelist():
            z.extract(name, out_dir)
            print(f"Extracted {name} to {out_dir}")

quran_dat = os.path.join(out_dir, "EasyQuran.dat")
hadees_dat = os.path.join(out_dir, "EasyHadees.dat")

def inspect_file(filepath):
    print(f"\n--- Inspecting {os.path.basename(filepath)} ---")
    size_mb = os.path.getsize(filepath) / (1024 * 1024)
    print(f"Size: {size_mb:.2f} MB")
    
    with open(filepath, "rb") as f:
        header = f.read(100)
        print("Header magic:", header[:30])
        
    if header.startswith(b"SQLite format 3"):
        print("Format: SQLite Database!")
        try:
            conn = sqlite3.connect(filepath)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            tables = cursor.fetchall()
            print("Tables in SQLite database:", [t[0] for t in tables])
            
            for t in tables:
                tname = t[0]
                cursor.execute(f"SELECT COUNT(*) FROM {tname}")
                cnt = cursor.fetchone()[0]
                print(f"  Table '{tname}': {cnt:,} rows")
            conn.close()
        except Exception as e:
            print(f"SQLite error: {e}")
    elif header.startswith(b"PK\x03\x04"):
        print("Format: ZIP archive!")
        with zipfile.ZipFile(filepath, 'r') as zf:
            print("Files inside DAT zip:", zf.namelist())
    else:
        print("Unknown binary format / Access MDB")

inspect_file(quran_dat)
inspect_file(hadees_dat)
