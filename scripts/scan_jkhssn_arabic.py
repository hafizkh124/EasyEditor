import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

search_paths = [r"D:\JKHSSN", r"D:\EEData\JKHSSN_Extracted"]
arabic_rich_files = []

for base in search_paths:
    if not os.path.exists(base):
        continue
    for root, dirs, files in os.walk(base):
        for f in files:
            fpath = os.path.join(root, f)
            try:
                size = os.path.getsize(fpath)
                if size < 5000:
                    continue
                with open(fpath, 'rb') as fp:
                    chunk = fp.read(10000)
                dec = chunk.decode('cp1256', errors='ignore')
                ar_count = sum(1 for c in dec if '\u0600' <= c <= '\u06FF')
                if ar_count > 500:
                    arabic_rich_files.append((fpath, size, ar_count))
            except Exception as e:
                pass

arabic_rich_files.sort(key=lambda x: x[2], reverse=True)
print(f"Found {len(arabic_rich_files)} files rich in Arabic CP1256 text:\n")
for fpath, size, ar_count in arabic_rich_files[:25]:
    rel = fpath.replace(r"D:\JKHSSN", "").replace(r"D:\EEData\JKHSSN_Extracted", "")
    print(f"  {ar_count:6d} Arabic chars | {size/1024/1024:6.2f} MB | {rel}")
