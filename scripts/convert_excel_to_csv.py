"""
Converts the 7 Urdu hadith Excel exports (Sihah Sittah + Muwatta Malik) into
the target scholarly_documents CSV shape.

Fixed two bugs found while auditing the original output:

1. Wrong hadith-number column. The old code read
   `hadith_number_relevant` (which is "0" on every single row in every file)
   before falling back to `Hadith id`, and picked whichever was truthy via
   `or`. The real per-book hadith number lives in `Hadith Number`
   (e.g. "Q1", "1", ...). Net effect: every citation collapsed onto a handful
   of identical strings per book/chapter, e.g. all 8,934 Bukhari rows sharing
   `صحیح بخاری - باب: کتاب: وحی کے بیان میں`.

2. citation_ref emitted as a plain string. scholarly_documents.citation_ref is
   JSONB and the app reads it as an object everywhere -- search_documents_scoped
   (citation_ref->>'collection'), the count RPCs' facet buckets, and
   src/lib/editor/citationFormat.ts's formatCitation() (collection, book,
   hadith_number, grade). A string citation_ref is valid JSONB and inserts
   without error, but the row is then invisible to search and renders a blank
   citation. This version emits a JSON object per row instead.

Also fixed: Chapter Urdu (کتاب) was being labelled "باب:" while the real
Sub chapter Urdu (باب) was dropped entirely. Both are now kept, correctly
labelled, under separate keys.

Collection slugs (bukhari, muslim, abudawud, ibnmajah, nasai, tirmidhi, malik)
match the ones already used under domain='hadith-json' in hadith_scholarly.csv,
so cross-domain duplicate/complement detection (ar_fingerprint, see
20260724220000_ar_fingerprint_and_check_batch.sql) lines up naturally.
"""
import os
import sys
import zipfile
import xml.etree.ElementTree as ET
import csv
import json

sys.stdout.reconfigure(encoding='utf-8')

EXCEL_FOLDER = r"D:\islamic urdu hadeed data"
OUTPUT_CSV = r"D:\EEData\hadith\hadeed_urdu_excel.csv"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# Filename prefix (without .xlsx) -> (collection slug, Arabic book name, English book name)
COLLECTION_SLUGS = {
    "01_sahih_bukhari":            ("bukhari",   "صحیح بخاری",        "Sahih al-Bukhari"),
    "02_sahih_muslim":             ("muslim",    "صحیح مسلم",          "Sahih Muslim"),
    "03_sunan_abi_dawud":          ("abudawud",  "سنن ابی داؤد",       "Sunan Abi Dawud"),
    "04_sunan_ibn_maja":           ("ibnmajah",  "سنن ابن ماجہ",       "Sunan Ibn Majah"),
    "05_sunan_nasai":              ("nasai",     "سنن نسائی",          "Sunan an-Nasai"),
    "06_sunan_tirmadhi":           ("tirmidhi",  "سنن ترمذی",          "Sunan at-Tirmidhi"),
    "07_moata_imam_malik_qasim":   ("malik",     "موطأ امام مالک",     "Muwatta Malik"),
}


def _col_letters_to_index(ref):
    letters = ''.join(ch for ch in ref if ch.isalpha())
    idx = 0
    for ch in letters:
        idx = idx * 26 + (ord(ch.upper()) - ord('A') + 1)
    return idx - 1


def _cell_value(c, strings):
    v_elem = c.find(f'{NS}v')
    if v_elem is None or v_elem.text is None:
        return ''
    if c.attrib.get('t') == 's':
        idx = int(v_elem.text)
        return strings[idx] if idx < len(strings) else v_elem.text
    return v_elem.text


def process_excel_files():
    if not os.path.exists(EXCEL_FOLDER):
        print(f"Directory not found: {EXCEL_FOLDER}")
        return []

    all_rows = []

    for fname in sorted(os.listdir(EXCEL_FOLDER)):
        if not fname.endswith('.xlsx'):
            continue

        stem = fname.replace('.xlsx', '')
        slug, book_ar, book_en = COLLECTION_SLUGS.get(stem, (stem, stem, stem))

        fpath = os.path.join(EXCEL_FOLDER, fname)
        print(f"Processing Excel file: {fname}  (collection={slug})...")

        try:
            with zipfile.ZipFile(fpath, 'r') as z:
                strings = []
                if 'xl/sharedStrings.xml' in z.namelist():
                    tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
                    for elem in tree.iter():
                        if elem.tag.endswith('}t'):
                            strings.append(elem.text or '')

                sheet_tree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
                xml_rows = sheet_tree.findall(f'{NS}sheetData/{NS}row')

                if not xml_rows:
                    continue

                headers = []
                for c in xml_rows[0].findall(f'{NS}c'):
                    headers.append(_cell_value(c, strings).strip())

                col_idx = {name: i for i, name in enumerate(headers)}

                book_name_idx  = col_idx.get('Book Name')
                chap_u_idx     = col_idx.get('Chapter Urdu')       # کتاب (book-section)
                sub_u_idx      = col_idx.get('Sub chapter Urdu')   # باب (chapter)
                hadith_id_idx  = col_idx.get('Hadith id')
                hadith_num_idx = col_idx.get('Hadith Number')      # the real per-book number
                arabic_idx     = col_idx.get('Arabic')
                urdu_idx       = col_idx.get('Urdu')
                takhreej_idx   = col_idx.get('Takhreej')
                english_idx    = col_idx.get('English')
                albani_idx     = col_idx.get('Albani_hukam')

                file_added = 0
                for r in xml_rows[1:]:
                    row_vals = {}
                    for c in r.findall(f'{NS}c'):
                        idx = _col_letters_to_index(c.attrib.get('r', ''))
                        row_vals[idx] = _cell_value(c, strings)

                    def get(i):
                        return row_vals.get(i, '') if i is not None else ''

                    bname   = get(book_name_idx) or book_ar
                    kitab   = get(chap_u_idx)
                    bab     = get(sub_u_idx)
                    hnum    = get(hadith_num_idx)
                    if not hnum or hnum == '0':
                        hnum = get(hadith_id_idx)
                    ar_txt  = get(arabic_idx)
                    ur_txt  = get(urdu_idx)
                    takh    = get(takhreej_idx)
                    en_txt  = get(english_idx)
                    albani  = get(albani_idx)

                    if not ur_txt and not ar_txt:
                        continue
                    if not hnum:
                        # No usable hadith number at all for this row -- skip
                        # rather than emit a citation that collides with
                        # every other number-less row in the book.
                        continue

                    citation_ref = {
                        "collection":    slug,
                        "book":          bname,
                        "book_en":       book_en,
                        "hadith_number": str(hnum),
                        "source":        "urdu-hadith-excel",
                    }
                    if kitab and kitab != '0':
                        citation_ref["kitab"] = kitab
                    if bab and bab != '0':
                        citation_ref["bab"] = bab
                    if albani and albani != '0':
                        citation_ref["grade"] = albani
                    if takh and takh != '0':
                        citation_ref["takhreej"] = takh
                    if en_txt and en_txt != '0':
                        citation_ref["english"] = en_txt

                    all_rows.append({
                        'domain': 'urdu-hadith',
                        'source_type': 'hadith',
                        'content': ur_txt,
                        'content_ar': ar_txt,
                        'citation_ref': json.dumps(citation_ref, ensure_ascii=False),
                        'language': 'ur',
                    })
                    file_added += 1

                print(f"  Added {file_added} records from {fname}.")

        except Exception as e:
            print(f"  Error reading {fname}: {e}")

    print(f"\nTotal Extracted Hadith Records across {len(COLLECTION_SLUGS)} Excel files: {len(all_rows)}")
    return all_rows


def _assert_clean(rows):
    """Fail loudly rather than silently shipping a broken CSV again."""
    problems = []

    if len(rows) != 37154:
        problems.append(f"expected 37,154 rows, got {len(rows)}")

    empty_content = sum(1 for r in rows if not r['content'].strip())
    if empty_content:
        problems.append(f"{empty_content} rows have empty content")

    empty_ar = sum(1 for r in rows if not r['content_ar'].strip())
    if empty_ar:
        problems.append(f"{empty_ar} rows have empty content_ar")

    bad_citations = 0
    citations = set()
    for r in rows:
        try:
            cit = json.loads(r['citation_ref'])
        except Exception:
            bad_citations += 1
            continue
        if not isinstance(cit, dict) or not cit.get('hadith_number'):
            bad_citations += 1
            continue
        citations.add((cit.get('collection'), cit.get('hadith_number'), cit.get('kitab'), cit.get('bab')))
    if bad_citations:
        problems.append(f"{bad_citations} rows have an unparseable or number-less citation_ref")

    if len(citations) <= 30000:
        problems.append(f"only {len(citations)} distinct citations (expected > 30,000) -- numbering likely collapsed again")

    if problems:
        print("\n*** VALIDATION FAILED ***")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)

    print(f"\nValidation passed: {len(rows)} rows, {len(citations)} distinct citations, zero empty fields.")


if __name__ == "__main__":
    rows = process_excel_files()

    if rows:
        _assert_clean(rows)

        os.makedirs(os.path.dirname(OUTPUT_CSV), exist_ok=True)
        with open(OUTPUT_CSV, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=['domain', 'source_type', 'content', 'content_ar', 'citation_ref', 'language'])
            w.writeheader()
            w.writerows(rows)

        print(f"Saved passthrough CSV to: {OUTPUT_CSV}")
        print("\n=== Sample Verified Records ===")
        for i, r in enumerate(rows[:3], 1):
            print(f"[{i}] citation_ref: {r['citation_ref']}")
            print(f"    Urdu:   {r['content'][:120]}...")
            print(f"    Arabic: {r['content_ar'][:120]}...\n")
