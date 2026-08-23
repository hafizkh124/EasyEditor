#!/usr/bin/env python3
"""
scrape_arabic_gap_books.py - scrape the 11 tohed-hadith-only books via
islamicurdubooks.com (IUB), which carries full-tashkeel Arabic matn for all
of them (verified live, 2026-08-23) where tohed.com never did.

BACKGROUND
----------
The Corpus Atlas (2026-08-20) flagged 69,304 tohed-hadith rows across 14
books as having no usable Arabic matn anywhere in the corpus. Auditing that
finding turned up two different situations:

  - 3 books (musannaf-ibn-abi-shaybah, mishkat-al-masabih,
    sahih-adab-al-mufrad) already have a real Arabic copy under a DIFFERENT
    domain (easyquran-hadith / hadith-json / islamicurdubooks-hadith) --
    collections.ts already marks them arabicMatn:true and routes searches
    there. No action needed.
  - 11 books (33,446 tohed rows) genuinely have no Arabic anywhere. Checked
    tohed.com's own CSV export (data/tohed_hadiths.csv): content_ar is empty
    on all 74,946 rows, and `content` never carries the matn either -- the
    scraper's Arabic selector apparently never matched on that site.

Live-probed all three of the user's suggested sources for these 11 (IUB,
easyquranwahadees.com, tohed.com) -- easyquranwahadees.com and tohed.com are
outside this sandbox's network allowlist, but IUB returned full-tashkeel
Arabic matn, hukm (grading), takhreej cross-references, and a complete isnad
chain with per-narrator rank on the first hadith of all 11 books. Quality
exceeds the tohed CSV (which has none of hukm/takhreej/isnad).

WHAT THIS SCRIPT DOES
----------------------
Reuses scrape_hadith.py's scrape_collection() unchanged -- same throttle,
same on-disk cache, same resumability, same CSV shape -- just pointed at
this book list instead of `main()`'s is_new filter. Output lands in
data/iub/{slug}.csv, one file per book, exactly like every other IUB scrape.

These are NOT loaded into scholarly_documents by this script. Loading is a
separate, deliberate step (via scripts/iub/load.py or ingest-batch) --
whether the new islamicurdubooks-hadith rows should join the existing
tohed-hadith rows or supersede them (the fath-al-rabbani precedent: kept but
excluded from embedding once a better copy existed) is a decision for after
the data is in hand, not before.

Usage:
    python scripts/iub/scrape_arabic_gap_books.py                # all 11
    python scripts/iub/scrape_arabic_gap_books.py --only darqutni,sahifa-hammam
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.registry import IUB_REGISTRY               # noqa: E402
from scripts.iub.scrape_hadith import scrape_collection      # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# (path, bookid) keys into IUB_REGISTRY, in ascending page-count order so
# progress becomes visible quickly and a partial run still finishes several
# whole books rather than being mid-way through the largest one.
TARGET_KEYS = [
    ("hadith", 8),    # sahifa-hammam            139 pages
    ("hadith", 16),   # musnad-ishaq             981
    ("hadith", 32),   # muntaqa-ibn-al-jarud   1,114
    ("hadith", 25),   # musnad-humaydi         1,337
    ("hadith", 39),   # musnad-shafii          1,819
    ("hadith", 31),   # lulu-wal-marjan        1,906
    ("hadith", 30),   # ibn-khuzaimah          3,080
    ("hadith", 10),   # silsilah-sahihah       4,103
    ("hadith", 36),   # sunan-saeed-bin-mansur 4,154
    ("hadith", 34),   # darqutni               4,836
    ("hadith", 37),   # sahih-ibn-hibban       7,491
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", type=str, default="",
                     help="comma-separated slugs to restrict to (default: all 11)")
    args = ap.parse_args()

    only = {s.strip() for s in args.only.split(",") if s.strip()} or None

    keys = TARGET_KEYS
    if only:
        keys = [k for k in keys if IUB_REGISTRY[k]["slug"] in only]
        missing = only - {IUB_REGISTRY[k]["slug"] for k in keys}
        if missing:
            print(f"Unknown slug(s), ignoring: {', '.join(sorted(missing))}")

    total_pages = sum(IUB_REGISTRY[k]["iub_total"] for k in keys)
    print(f"=== Scraping {len(keys)} Arabic-gap books, {total_pages:,} pages total ===\n", flush=True)

    grand_total = 0
    for key in keys:
        info = IUB_REGISTRY[key]
        count = scrape_collection(key[0], key[1], info, max_workers=4)
        grand_total += count

    print(f"\n🎉 DONE. {len(keys)} books, {grand_total:,} rows written under data/iub/*.csv.", flush=True)
    print("Not yet loaded into scholarly_documents -- that is a separate, deliberate step.", flush=True)


if __name__ == "__main__":
    main()
