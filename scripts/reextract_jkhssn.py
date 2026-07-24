import os
import sys
import re
import csv

sys.stdout.reconfigure(encoding='utf-8')

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

def extract_from_tokens_file(file_path):
    hadiths = []
    try:
        with open(file_path, 'rb') as f:
            content = f.read()
        
        # Decode as CP1256 (Windows Arabic)
        decoded = content.decode('cp1256', errors='ignore')
        
        # Split into null-terminated or tag-delimited chunks
        raw_chunks = decoded.split('\x00')
        
        for chunk in raw_chunks:
            chunk = chunk.strip()
            if len(chunk) < 25:
                continue
            
            # Count Arabic characters
            ar_count = sum(1 for c in chunk if '\u0600' <= c <= '\u06FF')
            if ar_count < 15:
                continue
            
            # Extract citation / book name if available
            book_name = "JKHSSN Hadith Collection"
            for b in KNOWN_BOOKS:
                if b in chunk or b.replace(' ', '') in chunk:
                    book_name = b
                    break
            
            # Extract Hadith number or page number if tagged
            hadith_num_match = re.search(r'رقم_حديث[^>]*>([^<]+)<', chunk)
            page_match = re.search(r'صفحة="([^"]+)"', chunk)
            part_match = re.search(r'جزء="([^"]+)"', chunk)
            
            ref_parts = [book_name]
            if hadith_num_match:
                ref_parts.append(f"Hadith #{hadith_num_match.group(1).strip()}")
            elif part_match and page_match:
                ref_parts.append(f"Vol {part_match.group(1)}, Page {page_match.group(1)}")
            
            citation_ref = " - ".join(ref_parts)
            
            # Strip XML tags to get clean plain text
            clean_text = re.sub(r'<[^>]+>', ' ', chunk)
            clean_text = re.sub(r'\s+', ' ', clean_text).strip()
            
            if len(clean_text) >= 20:
                hadiths.append({
                    'domain': 'Hadith',
                    'source_type': 'JKHSSN',
                    'content': '',
                    'content_ar': clean_text,
                    'citation_ref': citation_ref,
                    'language': 'ar'
                })
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
    
    return hadiths

def main():
    print("=" * 80)
    print("JKHSSN Hadith Re-Extraction (CP1256 Decoding)")
    print("=" * 80)
    
    candidate_files = []
    for base_path in JKHSSN_PATHS:
        if os.path.exists(base_path):
            for root, dirs, files in os.walk(base_path):
                for f in files:
                    if f.lower() in ['tokens.bin', 'tokenswc.bin'] or f.lower().endswith('.bin'):
                        fpath = os.path.join(root, f)
                        if 'dic' in fpath.lower() or 'tokens' in fpath.lower():
                            size_mb = os.path.getsize(fpath) / (1024 * 1024)
                            if size_mb > 0.05: # > 50 KB
                                candidate_files.append((fpath, size_mb))
    
    unique_candidates = {}
    for fpath, size in candidate_files:
        key = (os.path.basename(fpath), round(size, 2))
        if key not in unique_candidates:
            unique_candidates[key] = fpath
    
    files_to_process = list(unique_candidates.values())
    print(f"✓ Found {len(files_to_process)} candidate binary token files to process.")
    
    all_hadiths = []
    seen_texts = set()
    
    for i, fpath in enumerate(files_to_process, 1):
        rel_path = fpath.replace(r"D:\JKHSSN", "").replace(r"D:\EEData\JKHSSN_Extracted", "")
        print(f"[{i}/{len(files_to_process)}] Processing: {rel_path} ...", end=" ")
        
        extracted = extract_from_tokens_file(fpath)
        added = 0
        for item in extracted:
            sig = item['content_ar'][:80]
            if sig not in seen_texts:
                seen_texts.add(sig)
                all_hadiths.append(item)
                added += 1
        
        print(f"-> Extracted {len(extracted)} entries ({added} new unique).")
    
    print("-" * 80)
    print(f"Total Unique Clean Hadiths Extracted: {len(all_hadiths)}")
    print("-" * 80)
    
    if all_hadiths:
        os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
        with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['domain', 'source_type', 'content', 'content_ar', 'citation_ref', 'language'])
            writer.writeheader()
            writer.writerows(all_hadiths)
        
        print(f"✓ Successfully written clean output to: {OUTPUT_CSV}")
        print("\nSample Output Verification (First 3 Hadiths):")
        for idx, item in enumerate(all_hadiths[:3], 1):
            print(f"\n--- Hadith #{idx} [{item['citation_ref']}] ---")
            print(item['content_ar'][:150] + ("..." if len(item['content_ar']) > 150 else ""))
    else:
        print("⚠ No Hadiths extracted. Check path and file formats.")

if __name__ == "__main__":
    main()
