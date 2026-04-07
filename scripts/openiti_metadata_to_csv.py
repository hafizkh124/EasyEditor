#!/usr/bin/env python3
"""
openiti_metadata_to_csv.py — Offline ETL: OpenITI metadata TSV → scholarly_documents CSV

Source: https://github.com/OpenITI/metadata
  - File: OpenITI_metadata_2024.tsv (~12 MB)
  - Columns: id, title, author, date, tags, url, ...
  - Covers 7,000+ integrated classical Arabic texts

This script imports the METADATA only (discovery layer).
Full-text ingestion uses a curated whitelist of 25 high-value works.

Usage:
  python scripts/openiti_metadata_to_csv.py \
    --input  data/openiti/OpenITI_metadata_2024.tsv \
    --output data/openiti_metadata.csv \
    [--whitelist data/openiti/whitelist.txt]

Then import into Supabase:
  psql $DATABASE_URL -c "\\COPY scholarly_documents \
    (domain, source_type, title, content, citation_ref, language) \
    FROM 'data/openiti_metadata.csv' CSV HEADER"

Metadata rows do NOT need embeddings — they serve as a discovery index.
Only full-text ingestion (whitelist works) needs embedding via ingest-scholarly-data.

TSV column names (common across OpenITI metadata releases):
  id / OpenITI_ID / uri, author_lat / author, title_lat / title,
  date / hijri_date, tags, lang, tok_length, url
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path


# ── 25-work curated whitelist ─────────────────────────────────────────────────
# High-value classical texts for full-text vector ingestion.
# Matched against OpenITI id or title (case-insensitive substring match).
DEFAULT_WHITELIST = [
    # Tafsir
    "IbnKathir.Tafsir",
    "Tabari.Tafsir",
    "Qurtubi.Jamic",
    "Baghawi.MaCalimTanzil",
    "SuyutiJalalayn.Tafsir",
    # Hadith commentary
    "Ibn Hajar.FathBari",
    "Nawawi.SharhMuslim",
    "CAsqalani.Fath",
    # Fiqh
    "IbnQudama.Mughni",
    "Nawawi.Majmuc",
    "IbnRushd.Muqaddimat",
    "Marghinani.Hidaya",
    # Aqida
    "IbnTaymiyya.MajmucFatawa",
    "IbnQayyim.ZadMacad",
    "Ghazali.Ihya",
    # Sira & History
    "IbnHisham.Sira",
    "Waqidi.Maghazi",
    "IbnSacd.TabaqatKubra",
    "Tabari.Tarikh",
    # Arabic language
    "IbnManzur.LisanCarab",
    "Fayruzabadi.QamussMuhit",
    "Zamakhshari.Asas",
    # Usul al-Fiqh
    "Shafici.Risala",
    "Amidi.Ihkam",
    "IbnHazm.Ihkam",
]


def detect_columns(header: list[str]) -> dict[str, int]:
    """Map logical field names to column indices, handling different TSV variants."""
    header_lower = [h.lower().strip() for h in header]

    def find(*candidates: str) -> int:
        for c in candidates:
            try: return header_lower.index(c.lower())
            except ValueError: pass
        return -1

    return {
        "id":       find("id", "openiti_id", "uri", "text_id"),
        "author":   find("author_lat", "author", "auth_lat"),
        "title":    find("title_lat", "title", "title_ar"),
        "date":     find("date", "hijri_date", "death_date"),
        "tags":     find("tags", "genre", "subjects"),
        "lang":     find("lang", "language", "primary_language"),
        "tok_len":  find("tok_length", "tokens", "size"),
        "url":      find("url", "uri", "github_url"),
    }


def is_whitelisted(openiti_id: str, title: str, whitelist: list[str]) -> bool:
    """Check if this work appears in the curated whitelist."""
    check = f"{openiti_id} {title}".lower()
    return any(w.lower() in check for w in whitelist)


def main():
    parser = argparse.ArgumentParser(
        description="Convert OpenITI metadata TSV to scholarly_documents CSV"
    )
    parser.add_argument("--input",     required=True, help="Path to OpenITI_metadata_*.tsv")
    parser.add_argument("--output",    required=True, help="Output CSV path")
    parser.add_argument("--whitelist", default=None,
                        help="Path to text file with one OpenITI work ID per line (default: built-in 25 works)")
    parser.add_argument("--all",       action="store_true",
                        help="Import all metadata rows, not just whitelist (discovery index)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Load whitelist
    whitelist = DEFAULT_WHITELIST
    if args.whitelist:
        wl_path = Path(args.whitelist)
        if wl_path.exists():
            whitelist = [l.strip() for l in wl_path.read_text().splitlines() if l.strip()]
            print(f"[openiti] Loaded {len(whitelist)} entries from whitelist: {args.whitelist}")
        else:
            print(f"[WARN] Whitelist file not found, using default 25 works")

    print(f"[openiti] Reading metadata from: {input_path}")

    total_rows  = 0
    written     = 0
    whitelisted = 0

    with open(input_path, encoding="utf-8", errors="replace") as tsv_f, \
         open(args.output, "w", encoding="utf-8", newline="") as csv_f:

        reader = csv.reader(tsv_f, delimiter="\t")
        writer = csv.writer(csv_f, quoting=csv.QUOTE_ALL)
        writer.writerow([
            "domain", "source_type", "title", "content", "citation_ref", "language"
        ])

        header = next(reader, None)
        if header is None:
            print("[ERROR] Empty TSV file", file=sys.stderr)
            sys.exit(1)

        cols = detect_columns(header)
        print(f"[openiti] Detected columns: { {k: v for k, v in cols.items() if v >= 0} }")

        def get(row: list[str], key: str) -> str:
            idx = cols.get(key, -1)
            if idx < 0 or idx >= len(row): return ""
            return row[idx].strip()

        for row in reader:
            if not row: continue
            total_rows += 1

            openiti_id = get(row, "id")
            author     = get(row, "author")
            title      = get(row, "title")
            date       = get(row, "date")
            tags       = get(row, "tags")
            lang       = get(row, "lang") or "ar"
            tok_len    = get(row, "tok_len")
            url        = get(row, "url")

            if not openiti_id and not title:
                continue

            # For discovery-only import, include everything
            # For whitelist import, filter to curated works
            is_wl = is_whitelisted(openiti_id, title, whitelist)
            if is_wl:
                whitelisted += 1

            if not args.all and not is_wl:
                continue

            # Build content: metadata summary for discovery
            content_parts = []
            if title:
                content_parts.append(f"Title: {title}")
            if author:
                content_parts.append(f"Author: {author}")
            if date:
                content_parts.append(f"Date (AH): {date}")
            if tags:
                content_parts.append(f"Tags: {tags}")
            if tok_len:
                content_parts.append(f"Length: ~{tok_len} tokens")
            content = " | ".join(content_parts) if content_parts else title or openiti_id

            citation = {
                "openiti_id": openiti_id,
                "author":     author,
                "date_ah":    date,
                "tags":       tags,
            }
            if url:
                citation["url"] = url

            # Normalize language code
            if lang.startswith("ar"):
                lang_code = "ar"
            elif lang.startswith("en"):
                lang_code = "en"
            elif lang.startswith("ur"):
                lang_code = "ur"
            else:
                lang_code = "ar"  # default: most OpenITI texts are Arabic

            writer.writerow([
                "openiti-index",
                "classical",
                title or openiti_id,
                content,
                json.dumps(citation, ensure_ascii=False),
                lang_code,
            ])
            written += 1

    print()
    print(f"[openiti] Done.")
    print(f"  Total rows processed: {total_rows:,}")
    print(f"  Whitelisted works:    {whitelisted}")
    print(f"  Rows written:         {written:,}")
    print(f"  Output:               {args.output}")
    print()

    if args.all:
        print("NOTE: Full discovery import (--all). These rows are metadata only.")
        print("      They will NOT be embedded (content is too short for meaningful vectors).")
        print("      Use for admin search/browse only.")
    else:
        print("NOTE: Whitelist import. These rows ARE suitable for embedding.")
        embed_batches = (written + 99) // 100
        print(f"      Embedding batches needed: {embed_batches}")

    print()
    print("Next steps:")
    print(f"  1. Import:  psql $DATABASE_URL -c \"\\\\COPY scholarly_documents \\")
    print(f"              (domain, source_type, title, content, citation_ref, language) \\")
    print(f"              FROM '{args.output}' CSV HEADER\"")
    print(f"  2. Verify:  SELECT COUNT(*) FROM scholarly_documents WHERE domain='openiti-index';")


if __name__ == "__main__":
    main()
