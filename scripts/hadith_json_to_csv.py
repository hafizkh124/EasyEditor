#!/usr/bin/env python3
"""
hadith_json_to_csv.py — Offline ETL: AhmedBaset/hadith-json → scholarly_documents CSV

Source: https://github.com/AhmedBaset/hadith-json
  - 17 books, ~50,884 hadiths in JSON format
  - File layout: data/{collection}/{collection}.json
    Each file: { "id": "...", "metadata": {...}, "hadiths": [...] }
    Each hadith: { "id", "idInBook", "chapterId", "bookId",
                   "arab": "...", "array": [...translations...] }

Usage:
  python scripts/hadith_json_to_csv.py \
    --input  data/hadith-json/ \
    --output data/hadith_normalized.csv

Then import into Supabase:
  psql $DATABASE_URL -c "\\COPY scholarly_documents \
    (domain, source_type, title, content, content_ar, citation_ref, language) \
    FROM 'data/hadith_normalized.csv' CSV HEADER"

After import, run embedding batches via ingest-scholarly-data edge function.
50,884 hadiths = 510 batches of 100 (or 102 batches of 500 via CLI loop).

Grade constants used across major collections:
  صحيح (Sahih), حسن (Hasan), ضعيف (Daif/Weak), موضوع (Fabricated)
"""
import argparse
import csv
import json
import os
import re
import unicodedata
from pathlib import Path


# ── Collection metadata ───────────────────────────────────────────────────────
# Maps collection directory name → human-readable book name + English name
COLLECTION_META = {
    "bukhari":     ("صحيح البخاري",       "Sahih Al-Bukhari"),
    "muslim":      ("صحيح مسلم",           "Sahih Muslim"),
    "tirmidhi":    ("سنن الترمذي",         "Jami At-Tirmidhi"),
    "abudawud":    ("سنن أبي داود",        "Sunan Abu Dawud"),
    "ibnmajah":    ("سنن ابن ماجه",        "Sunan Ibn Majah"),
    "nasai":       ("سنن النسائي",         "Sunan An-Nasa'i"),
    "malik":       ("موطأ مالك",           "Muwatta Malik"),
    "darimi":      ("سنن الدارمي",         "Sunan Ad-Darimi"),
    "ahmed":       ("مسند أحمد",           "Musnad Ahmad"),
    "nawawi40":    ("الأربعون النووية",    "Nawawi's 40 Hadiths"),
    "qudsi":       ("الأحاديث القدسية",   "Hadith Al-Qudsi"),
    "riyadussalihin": ("رياض الصالحين",   "Riyad As-Salihin"),
    "bulughalmaram": ("بلوغ المرام",      "Bulugh Al-Maram"),
    "adab":        ("الأدب المفرد",        "Al-Adab Al-Mufrad"),
    "shahih-al-jami": ("صحيح الجامع",     "Sahih Al-Jami"),
    "mishkat":     ("مشكاة المصابيح",     "Mishkat Al-Masabih"),
    "hisn-alhisar": ("حصن المسلم",        "Hisn Al-Muslim"),
}


def normalize_arabic(text: str) -> str:
    """Strip harakat and normalize alef variants (mirrors arabicUtils.ts)."""
    # Strip harakat (U+064B–U+065F) and dagger alef (U+0670)
    text = re.sub(r'[\u064B-\u065F\u0670]', '', text)
    # Normalize alef variants (آ أ إ ٱ) → bare alef ا
    text = re.sub(r'[\u0622\u0623\u0625\u0671]', '\u0627', text)
    # ta marbuta ة → ha ه
    text = text.replace('\u0629', '\u0647')
    # alef maqsura ى → ya ي
    text = text.replace('\u0649', '\u064A')
    return text.strip()


def extract_grade(hadith: dict, collection: str) -> str:
    """Best-effort grade extraction from various JSON structures."""
    # Try common grade keys
    for key in ("grade", "grades", "gradeAr", "grade_ar", "darajah"):
        val = hadith.get(key)
        if val:
            if isinstance(val, list):
                val = val[0] if val else ""
            if isinstance(val, dict):
                val = val.get("grade") or val.get("en") or val.get("ar") or ""
            if val:
                return str(val).strip()

    # Well-known fully-sahih collections
    ALWAYS_SAHIH = {"bukhari", "muslim"}
    if collection in ALWAYS_SAHIH:
        return "صحيح"

    return ""


def extract_translations(hadith: dict) -> dict[str, str]:
    """Extract language→text mappings from the 'array' field or named keys."""
    texts: dict[str, str] = {}

    # Format A: { "arab": "...", "array": [{"lang":"en","text":"..."}, ...] }
    if "array" in hadith and isinstance(hadith["array"], list):
        for entry in hadith["array"]:
            if isinstance(entry, dict):
                lang = entry.get("lang", "en")
                text = entry.get("text") or entry.get("body") or ""
                if text:
                    texts[lang] = str(text).strip()

    # Format B: { "arab": "...", "en": "...", "ur": "..." }
    for lang in ("en", "ur", "fr", "id", "tr"):
        if lang not in texts and lang in hadith:
            val = hadith[lang]
            if isinstance(val, str) and val.strip():
                texts[lang] = val.strip()
            elif isinstance(val, dict):
                body = val.get("body") or val.get("text") or ""
                if body:
                    texts[lang] = str(body).strip()

    return texts


def process_collection(json_path: Path, collection: str, writer: csv.writer) -> int:
    """Process one collection JSON file and write rows. Returns count written."""
    with open(json_path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"  [WARN] JSON parse error in {json_path}: {e}")
            return 0

    # Support both top-level list and {"hadiths": [...]}
    hadiths = data if isinstance(data, list) else data.get("hadiths", [])
    if not hadiths:
        print(f"  [WARN] No hadiths found in {json_path}")
        return 0

    meta_ar, meta_en = COLLECTION_META.get(collection, (collection, collection))
    count = 0

    for hadith in hadiths:
        if not isinstance(hadith, dict):
            continue

        # Arabic text
        ar_text = (
            hadith.get("arab") or
            hadith.get("arabic") or
            hadith.get("ar") or
            ""
        )
        if isinstance(ar_text, dict):
            ar_text = ar_text.get("body") or ar_text.get("text") or ""
        ar_text = str(ar_text).strip()

        # Translations
        translations = extract_translations(hadith)
        en_text = translations.get("en", "")

        # Skip if no meaningful content
        if not ar_text and not en_text:
            continue

        # Hadith number
        hadith_num = (
            hadith.get("idInBook") or
            hadith.get("hadithNumber") or
            hadith.get("id") or
            ""
        )

        # Grade
        grade = extract_grade(hadith, collection)

        # Chapter/book within collection
        chapter_id = hadith.get("chapterId") or hadith.get("bookId") or ""
        chapter_name = hadith.get("chapterName") or ""

        # Narrator (rawi) — not always present in hadith-json
        rawi = hadith.get("rawi") or hadith.get("narrator") or ""

        # Build merged content: normalized Arabic + English
        content_parts = []
        if ar_text:
            content_parts.append(ar_text)
        if en_text:
            content_parts.append(en_text)
        if not content_parts:
            continue
        content = "\n\n".join(content_parts)

        title = f"{meta_en} — Hadith {hadith_num}"
        if chapter_name:
            title += f" ({chapter_name})"

        citation = {
            "book":         meta_ar,
            "book_en":      meta_en,
            "collection":   collection,
            "hadith_number": str(hadith_num),
            "grade":        grade,
        }
        if rawi:
            citation["rawi"] = rawi
        if chapter_id:
            citation["chapter_id"] = str(chapter_id)

        writer.writerow([
            "hadith-json",
            "hadith",
            title,
            content,
            ar_text if ar_text else "",
            json.dumps(citation, ensure_ascii=False),
            "ar",
        ])
        count += 1

    return count


def main():
    parser = argparse.ArgumentParser(
        description="Convert AhmedBaset/hadith-json to scholarly_documents CSV"
    )
    parser.add_argument(
        "--input",  required=True,
        help="Path to hadith-json repo root (contains collection subdirs)"
    )
    parser.add_argument(
        "--output", required=True,
        help="Output CSV path"
    )
    parser.add_argument(
        "--collections", nargs="*", default=None,
        help="Subset of collection IDs to process (default: all)"
    )
    args = parser.parse_args()

    input_dir = Path(args.input)
    if not input_dir.exists():
        print(f"[ERROR] Input directory not found: {input_dir}")
        return

    # Discover collection JSON files
    # hadith-json layout: {root}/data/{collection}/{collection}.json
    # OR flat: {root}/{collection}.json
    json_files: list[tuple[str, Path]] = []

    data_dir = input_dir / "data"
    search_root = data_dir if data_dir.exists() else input_dir

    for item in sorted(search_root.iterdir()):
        if item.is_dir():
            # Look for {collection}/{collection}.json
            candidate = item / f"{item.name}.json"
            if candidate.exists():
                json_files.append((item.name, candidate))
            else:
                # Try any .json in the dir
                for jf in sorted(item.glob("*.json")):
                    json_files.append((item.name, jf))
        elif item.suffix == ".json":
            json_files.append((item.stem, item))

    if not json_files:
        print(f"[ERROR] No JSON files found under {search_root}")
        return

    if args.collections:
        json_files = [(col, p) for col, p in json_files if col in args.collections]
        print(f"[hadith_json_to_csv] Filtering to collections: {args.collections}")

    print(f"[hadith_json_to_csv] Found {len(json_files)} collection(s)")

    total = 0
    with open(args.output, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_ALL)
        writer.writerow([
            "domain", "source_type", "title",
            "content", "content_ar", "citation_ref", "language"
        ])

        for collection, json_path in json_files:
            print(f"  Processing {collection} ({json_path.name})...")
            count = process_collection(json_path, collection, writer)
            print(f"    → {count} hadiths")
            total += count

    print()
    print(f"[hadith_json_to_csv] Done. {total} rows written to {args.output}")
    print()
    embed_batches = (total + 99) // 100
    cli_batches   = (total + 499) // 500
    print("Next steps:")
    print(f"  1. Import:  psql $DATABASE_URL -c \"\\\\COPY scholarly_documents \
(domain, source_type, title, content, content_ar, citation_ref, language) \
FROM '{args.output}' CSV HEADER\"")
    print(f"  2. Verify:  SELECT COUNT(*) FROM scholarly_documents WHERE domain='hadith-json';")
    print(f"              -- Expected: ~{total}")
    print(f"  3. Embed:   {embed_batches} embedding batches of 100 via ingest-scholarly-data")
    print(f"              CLI loop: {cli_batches} invocations of batchSize=500")
    print()
    print("  # Batch embedding CLI loop:")
    print(f"  for i in $(seq 0 {cli_batches - 1}); do")
    print(f"    supabase functions invoke ingest-scholarly-data \\")
    print(f"      --data \"{{\\\"dataset\\\":\\\"hadith-json\\\",\\\"batchStart\\\":$((i*500)),\\\"batchSize\\\":500}}\"")
    print(f"    sleep 2")
    print(f"  done")


if __name__ == "__main__":
    main()
