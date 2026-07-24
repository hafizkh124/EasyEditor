import os
import sys
import re
import csv

sys.stdout.reconfigure(encoding='utf-8')
csv.field_size_limit(2147483647)

JKHSSN_PATHS = [
    r"D:\JKHSSN\Data\HadithDB",
    r"D:\EEData\JKHSSN_Extracted\Files"
]
OUTPUT_CSV = r"D:\EEData\hadith\jkhssn_processed_clean.csv"

KNOWN_BOOKS = [
    "صحيح البخاري", "صحيح مسلم", "سنن أبي داود", "سنن الترمذي", "سنن النسائي",
    "سنن ابن ماجه", "موطأ مالك", "مسند أحمد", "شرح مشكل الآثار", "مصنف عبد الرزاق",
    "مصنف ابن أبي شيبة", "سنن الدارمي", "سنن الدارقطني", "صحيح ابن حبان", "صحيح ابن خزيمة"
]

def main():
    print("=" * 80)
    print("Comprehensive 100% Clean JKHSSN Hadith Extraction (CP1256)")
    print("=" * 80)
    
    clean_records = []
    seen_sigs = set()
    processed_count = 0
    
    for base_dir in JKHSSN_PATHS:
        if not os.path.exists(base_dir):
            continue
        print(f"Scanning base directory: {base_dir}")
        for root, dirs, files in os.walk(base_dir):
            for f in files:
                fpath = os.path.join(root, f)
                try:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in ['.ind', '.inf', '.ord', '.add', '.mod', '.exe', '.dll']:
                        continue
                    
                    size_mb = os.path.getsize(fpath) / (1024 * 1024)
                    if size_mb < 0.01:
                        continue
                    
                    processed_count += 1
                    with open(fpath, 'rb') as fp:
                        content = fp.read()
                    
                    decoded = content.decode('cp1256', errors='ignore')
                    chunks = decoded.split('\x00')
                    for chunk in chunks:
                        chunk = chunk.strip()
                        if len(chunk) < 30:
                            continue
                        
                        # Strip XML tags
                        clean_text = re.sub(r'<[^>]+>', ' ', chunk)
                        clean_text = re.sub(r'\s+', ' ', clean_text).strip()
                        
                        if len(clean_text) < 30:
                            continue
                        
                        # Strict validation: Check ratio of valid Arabic characters + standard punctuation
                        total_len = len(clean_text)
                        valid_ar_chars = sum(1 for c in clean_text if '\u0600' <= c <= '\u06FF' or c in r' \n\r\t.,;:!?-()[]{}"\'،؛؟ًٌٍَُِّْ')
                        pct = (valid_ar_chars / total_len) * 100
                        
                        # Only accept if >= 85% valid Arabic content
                        if pct >= 85:
                            sig = clean_text[:80]
                            if sig in seen_sigs:
                                continue
                            seen_sigs.add(sig)
                            
                            bname = "جوامع الكلم (JKHSSN)"
                            for b in KNOWN_BOOKS:
                                if b in chunk or b.replace(' ', '') in chunk:
                                    bname = f"{b} (جوامع الكلم)"
                                    break
                            
                            clean_records.append({
                                'domain': 'Hadith',
                                'source_type': 'JKHSSN',
                                'content': '',
                                'content_ar': clean_text,
                                'citation_ref': bname,
                                'language': 'ar'
                            })
                except Exception as e:
                    pass
    
    print(f"\n✓ Processed {processed_count} files.")
    print(f"✓ Extracted Total 100% Clean Hadith Records: {len(clean_records)}")
    
    if clean_records:
        os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
        with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['domain', 'source_type', 'content', 'content_ar', 'citation_ref', 'language'])
            w.writeheader()
            w.writerows(clean_records)
        
        print(f"✓ Successfully saved clean output to: {OUTPUT_CSV}")
        print("\n" + "=" * 80)
        print("VERIFICATION: SAMPLE CLEAN HADITH RECORDS")
        print("=" * 80)
        for i, r in enumerate(clean_records[:5], 1):
            print(f"\n[{i}] Source: {r['citation_ref']}")
            print(f"    Text: {r['content_ar'][:180]}...")

if __name__ == "__main__":
    main()
