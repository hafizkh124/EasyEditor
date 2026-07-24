#!/usr/bin/env python3
"""
classical_to_csv.py — Offline ETL: Tier-2 classical corpus → scholarly_documents CSV

Turns Shamela / OpenITI classical books (fiqh, fatawa, tafsir, lughat, rijal,
nahw) into the same scholarly_documents CSV shape the Quran/Hadith loaders use,
adding the fields the Tier-2 retrieval path needs:
  - citation_ref.discipline  → the scope dimension (see _shared/disciplines.ts)
  - citation_ref.book_id/volume/page/author/death_year/madhhab → citations
  - passage_key              → stable identity for dedup/rerank

INPUT — a manifest JSON describing the books plus, per book, a pages JSONL:

  manifest.json:
  {
    "books": [
      {
        "book_id": "hidaya",
        "title": "الهداية في شرح بداية المبتدي",
        "title_en": "Al-Hidaya",
        "author": "برهان الدين المرغيناني",
        "death_year": 593,
        "discipline": "fiqh",          # fiqh|fatwa|tafsir|lughat|rijal|nahw
        "madhhab": "hanafi",           # optional
        "domain": "shamela",           # shamela|openiti|qul-tafsir|islamqa-cache
        "source_url": "https://shamela.ws/book/12345",
        "pages_file": "hidaya.pages.jsonl"
      }
    ]
  }

  <book>.pages.jsonl — one JSON object per line, one page/section each:
    {"volume": 1, "page": 12, "text": "...عربي...", "chapter": "كتاب الطهارة"}
    # tafsir pages may add: "surah": 2, "verse": 255, "mufassir": "..."
    # fatwa pages may add:  "fatwa_number": "1234", "scholar": "..."

Usage:
  python scripts/classical_to_csv.py \
    --manifest data/classical/manifest.json \
    --base-dir data/classical \
    --output   data/classical_normalized.csv

Then import (note the explicit column list — it includes source_url + passage_key
which the Quran/Hadith loaders omit):
  psql $DATABASE_URL -c "\\COPY scholarly_documents \
    (domain, source_type, title, content, content_ar, citation_ref, language, \
     source_url, passage_key) \
    FROM 'data/classical_normalized.csv' CSV HEADER"

After import, backfill embeddings via the backfill-embeddings edge function so
the semantic channel can see these rows.

See scripts/CLASSICAL_INGEST.md for the full playbook.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

# Windows consoles default to a non-UTF8 codepage (cp1256), which chokes on the
# few non-ASCII characters in our status output. Force UTF-8 stdout where we can.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


# Valid disciplines — MUST match DISCIPLINE_SLUGS in
# supabase/functions/_shared/disciplines.ts
VALID_DISCIPLINES = {"fiqh", "fatwa", "tafsir", "lughat", "rijal", "nahw"}

# discipline → scholarly_documents.source_type
DISCIPLINE_SOURCE_TYPE = {
    "fiqh":   "classical",
    "lughat": "classical",
    "rijal":  "classical",
    "nahw":   "classical",
    "tafsir": "tafsir",
    "fatwa":  "fatwa",
}

VALID_DOMAINS = {"shamela", "openiti", "qul-tafsir", "islamqa-cache"}


def normalize_arabic(text: str) -> str:
    """Strip harakat and normalize letter variants (mirrors arabicUtils.ts and
    the SQL normalize_arabic_text used by the lexical search RPCs)."""
    text = re.sub(r'[ً-ٰٟ]', '', text)          # harakat + dagger alef
    text = re.sub(r'[آأإٱ]', 'ا', text)  # alef variants → ا
    text = text.replace('ة', 'ه')                    # ة → ه
    text = text.replace('ى', 'ي')                    # ى → ي
    return text.strip()


def build_passage_key(book_id: str, page: dict, discipline: str) -> str:
    """Stable, unique identity for a page/section. Kept in its own namespace so
    it never collides with quran:/hadith: keys."""
    if discipline == "tafsir" and page.get("surah") is not None:
        return f"tafsir:{book_id}:{page.get('surah')}:{page.get('verse', 0)}"
    vol = page.get("volume", 0)
    pg = page.get("page", 0)
    return f"classical:{book_id}:v{vol}:p{pg}"


def process_book(book: dict, base_dir: Path, writer: csv.writer) -> int:
    book_id = book.get("book_id")
    discipline = book.get("discipline")
    domain = book.get("domain")

    if not book_id:
        print("  [WARN] book missing 'book_id' — skipped")
        return 0
    if discipline not in VALID_DISCIPLINES:
        print(f"  [WARN] {book_id}: invalid discipline {discipline!r} "
              f"(expected one of {sorted(VALID_DISCIPLINES)}) — skipped")
        return 0
    if domain not in VALID_DOMAINS:
        print(f"  [WARN] {book_id}: invalid domain {domain!r} "
              f"(expected one of {sorted(VALID_DOMAINS)}) — skipped")
        return 0

    pages_file = book.get("pages_file")
    if not pages_file:
        print(f"  [WARN] {book_id}: no 'pages_file' — skipped")
        return 0
    pages_path = base_dir / pages_file
    if not pages_path.exists():
        print(f"  [WARN] {book_id}: pages file not found: {pages_path} — skipped")
        return 0

    source_type = DISCIPLINE_SOURCE_TYPE[discipline]
    title = book.get("title", book_id)
    title_en = book.get("title_en", "")
    author = book.get("author", "")
    death_year = book.get("death_year")
    madhhab = book.get("madhhab")
    source_url = book.get("source_url", "")

    count = 0
    with open(pages_path, encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                page = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"  [WARN] {book_id}: JSON error on line {line_no}: {e}")
                continue

            ar_text = str(page.get("text") or "").strip()
            if len(ar_text) < 3:
                continue

            citation = {
                "discipline": discipline,
                "book_id":    book_id,
                "title":      title,
                "author":     author,
            }
            if title_en:
                citation["title_en"] = title_en
            if death_year is not None:
                citation["death_year"] = death_year
            if madhhab:
                citation["madhhab"] = madhhab
            if page.get("volume") is not None:
                citation["volume"] = page["volume"]
            if page.get("page") is not None:
                citation["page"] = page["page"]
            if page.get("chapter"):
                citation["chapter"] = page["chapter"]
            # discipline-specific extras
            if discipline == "tafsir":
                if page.get("surah") is not None:
                    citation["surah"] = page["surah"]
                if page.get("verse") is not None:
                    citation["verse"] = page["verse"]
                if page.get("mufassir"):
                    citation["mufassir"] = page["mufassir"]
            if discipline == "fatwa":
                if page.get("fatwa_number"):
                    citation["fatwa_number"] = page["fatwa_number"]
                if page.get("scholar"):
                    citation["scholar"] = page["scholar"]

            loc = []
            if page.get("volume") is not None:
                loc.append(f"ج{page['volume']}")
            if page.get("page") is not None:
                loc.append(f"ص{page['page']}")
            row_title = f"{title}" + (f" — {'/'.join(loc)}" if loc else "")

            passage_key = build_passage_key(book_id, page, discipline)

            writer.writerow([
                domain,
                source_type,
                row_title,
                ar_text,                      # content (Arabic-only for classical)
                normalize_arabic(ar_text),    # content_ar (searched by lexical RPC)
                json.dumps(citation, ensure_ascii=False),
                "ar",
                source_url,
                passage_key,
            ])
            count += 1

    return count


def main():
    parser = argparse.ArgumentParser(
        description="Convert Tier-2 classical books to scholarly_documents CSV"
    )
    parser.add_argument("--manifest", required=True, help="Path to manifest JSON")
    parser.add_argument("--base-dir", default=None,
                        help="Directory the manifest's pages_file paths are relative to "
                             "(default: the manifest's own directory)")
    parser.add_argument("--output", required=True, help="Output CSV path")
    parser.add_argument("--disciplines", nargs="*", default=None,
                        help="Only ingest books of these disciplines (default: all)")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        print(f"[ERROR] Manifest not found: {manifest_path}")
        return
    base_dir = Path(args.base_dir) if args.base_dir else manifest_path.parent

    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    books = manifest.get("books", [])
    if args.disciplines:
        books = [b for b in books if b.get("discipline") in set(args.disciplines)]
    if not books:
        print("[ERROR] No books to process.")
        return

    print(f"[classical_to_csv] {len(books)} book(s) from {manifest_path}")

    total = 0
    with open(args.output, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_ALL)
        writer.writerow([
            "domain", "source_type", "title", "content", "content_ar",
            "citation_ref", "language", "source_url", "passage_key",
        ])
        for book in books:
            bid = book.get("book_id", "?")
            print(f"  Processing {bid} ({book.get('discipline')})...")
            n = process_book(book, base_dir, writer)
            print(f"    -> {n} pages")
            total += n

    print()
    print(f"[classical_to_csv] Done. {total} rows written to {args.output}")
    print()
    print("Next steps:")
    print(f"  1. Import: psql $DATABASE_URL -c \"\\\\COPY scholarly_documents "
          "(domain, source_type, title, content, content_ar, citation_ref, "
          f"language, source_url, passage_key) FROM '{args.output}' CSV HEADER\"")
    print("  2. Verify: SELECT citation_ref->>'discipline' AS discipline, COUNT(*) "
          "FROM scholarly_documents GROUP BY 1;")
    print("  3. Embed:  backfill-embeddings edge function (batches of 100–500).")


if __name__ == "__main__":
    main()
