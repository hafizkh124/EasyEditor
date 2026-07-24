import os
import sys
import re
import csv

sys.stdout.reconfigure(encoding='utf-8')

JKHSSN_DB = r"D:\JKHSSN\Data\HadithDB"
OUTPUT_CSV = r"D:\EEData\hadith\jkhssn_processed_clean.csv"

KNOWN_BOOKS = [
    "صحيح البخاري", "صحيح مسلم", "سنن أبي داود", "سنن الترمذي", "سنن النسائي",
    "سنن ابن ماجه", "موطأ مالك", "مسند أحمد", "شرح مشكل الآثار", "مصنف عبد الرزاق",
    "مصنف ابن أبي شيبة", "سنن الدارمي", "سنن الدارقطني", "صحيح ابن حبان", "صحيح ابن خزيمة"
]

def main():
    print("=" * 80)
    print("JKHSSN Fast Clean Re-Extraction (CP1256)")
    print("=" * 80)
    
    records = []
    seen = set()
    
    for root, dirs, files in os.walk(JKHSSN_DB):
        for f in files:
            if f.lower() in ['tokens.bin', 'tokenswc.bin']:
                fpath = os.path.join(root, f)
                try:
                    with open(fpath, 'rb') as fp:
                        content = fp.read()
                    decoded = content.decode('cp1256', errors='ignore')
                    chunks = decoded.split('\x00')
                    for chunk in chunks:
                        chunk = chunk.strip()
                        if len(chunk) < 30:
                            continue
                        
                        ar_chars = [c for c in chunk if '\u0600' <= c <= '\u06FF']
                        if len(ar_chars) < 20:
                            continue
                        
                        clean_text = re.sub(r'<[^>]+>', ' ', chunk)
                        clean_text = re.sub(r'\s+', ' ', clean_text).strip()
                        
                        if len(clean_text) < 30:
                            continue
                        
                        sig = clean_text[:80]
                        if sig in seen:
                            continue
                        seen.add(sig)
                        
                        bname = "جوامع الكلم (JKHSSN)"
                        for b in KNOWN_BOOKS:
                            if b in chunk or b.replace(' ', '') in chunk:
                                bname = f"{b} (جوامع الكلم)"
                                break
                        
                        records.append({
                            'domain': 'Hadith',
                            'source_type': 'JKHSSN',
                            'content': '',
                            'content_ar': clean_text,
                            'citation_ref': bname,
                            'language': 'ar'
                        })
                except Exception as e:
                    pass
    
    print(f"✓ Total unique clean Hadith records extracted: {len(records)}")
    
    if records:
        os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
        with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['domain', 'source_type', 'content', 'content_ar', 'citation_ref', 'language'])
            w.writeheader()
            w.writerows(records)
        
        print(f"✓ Output successfully saved to: {OUTPUT_CSV}")
        print("\n" + "=" * 80)
        print("VERIFICATION: SAMPLE EXTRACTED HADITH RECORDS")
        print("=" * 80)
        for i, r in enumerate(records[:5], 1):
            print(f"\n[{i}] Source: {r['citation_ref']}")
            print(f"    Text: {r['content_ar'][:180]}...")
    else:
        print("⚠ No records extracted.")

if __name__ == "__main__":
    main()
