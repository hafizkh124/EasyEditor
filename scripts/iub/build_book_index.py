"""
build_book_index.py - Phase E step 1.2: full-book verification for books the
alignment probe classified RECOVERABLE. UNALIGNED books are skipped
entirely and reported, never force-mapped.

For each qualifying book:
  1. Scrape EVERY hadith_number 1..total from IUB into
     data/iub_index/{slug}.json (hadith_number -> extracted Arabic text). This
     reuses client.py's on-disk cache, so a rerun after interruption costs
     nothing for pages already fetched -- the index file itself is also a
     durable asset once written.
  2. Pull the DB's ENTIRE db_collection once via citation_lookup.py's
     fetch_full_collection() -- see that module's docstring for why: IUB's
     numbering drifts LOCALLY and unevenly against the pre-existing domains
     (confirmed on Sahih Bukhari: real matches at k = -257 through +308,
     all within one book), so no fixed window or single constant offset can
     be trusted. Only an unbounded search against the whole collection can.
  3. For every hadith_number, search the whole collection (expanding-radius
     search, see best_match_expanding) and classify:
       MATCH     -- ratio >= OVERLAP_THRESHOLD found somewhere in the collection
       NO_MATCH  -- no candidate cleared the threshold; existing citation
                    (if any) is left untouched

Also carries the label-scoped extraction fix from scrape_hadith.py /
probe_alignment.py: a page for a hadith that opens a new bab often carries a
PRECEDING epigraph block (a quoted Quran verse) in its own tashkeel wrapper,
labelled "حدیث نمبر: QN" rather than "N" -- grabbed indiscriminately by a
plain findall(), corrupting the extracted text for every such hadith.

Output: data/iub_index/{slug}_matches.json, one row per hadith_number with its
classification (and, on MATCH, the actual db_hadith_number found -- which may
differ from the IUB number by any local amount, not a book-wide constant) --
this is what apply_citation_urls.py reads to build the actual
update-citation payload.
"""

import os
import re
import sys
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.registry import IUB_REGISTRY
from scripts.iub.ar_normalize import content_tokens, token_overlap_ratio
from scripts.iub.client import fetch_page, MAX_WORKERS
from scripts.iub.scrape_hadith import clean_html
from scripts.iub.citation_lookup import fetch_full_collection, tokenize_collection, best_match_expanding

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

INDEX_DIR = os.path.join("data", "iub_index")
os.makedirs(INDEX_DIR, exist_ok=True)

OVERLAP_THRESHOLD = 0.6      # see probe_alignment.py's OVERLAP_THRESHOLD for the validation numbers
UPPER_BOUND_MARGIN = 500     # see probe_alignment.py's UPPER_BOUND_MARGIN

RE_LABELLED = re.compile(
    r'<span class="fontcalibri fs1 hno_color bold">([^<]+)</span>.*?'
    r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>',
    re.DOTALL,
)
RE_TASHKEEL = re.compile(r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>', re.DOTALL)
RE_ARABIC = re.compile(r'class=["\'][^"\']*hadith_arabic[^"\']*["\'][^>]*>(.*?)</div>', re.DOTALL)


def extract_arabic(html, hno):
    pairs = RE_LABELLED.findall(html)
    target = str(hno)
    exact = [content for label, content in pairs if label.strip() == target]
    if exact:
        return clean_html(" ".join(exact))
    if pairs:
        return clean_html(" ".join(content for _, content in pairs))

    matches = RE_TASHKEEL.findall(html) or RE_ARABIC.findall(html)
    return clean_html(" ".join(matches)) if matches else ""


def _fetch_one(path, bookid, slug, n):
    url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={n}"
    html, is_missing, err = fetch_page(url, module=f"bookidx_{slug}", key=str(n))
    if html and not is_missing:
        ar = extract_arabic(html, n)
        if ar:
            return n, ar
    return n, None


def scrape_book_texts(path, bookid, slug, total):
    out_file = os.path.join(INDEX_DIR, f"{slug}.json")
    if os.path.exists(out_file):
        with open(out_file, encoding="utf-8") as f:
            existing = json.load(f)
        if len(existing) >= total * 0.99:
            print(f"   Loaded existing index ({len(existing):,} entries), skipping scrape.", flush=True)
            return existing

    # client.py's throttle divides its per-request delay by MAX_WORKERS,
    # i.e. it is a shared budget meant to be filled by MAX_WORKERS concurrent
    # callers (see client.py's module docstring) -- calling it from a single
    # thread, as an earlier version of this function did, meant every request
    # paid a full network round-trip with none of the intended parallelism
    # (confirmed live: ~0.5 req/s instead of the ~5 req/s aggregate budget).
    texts = {}
    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = [pool.submit(_fetch_one, path, bookid, slug, n) for n in range(1, total + 1)]
        for fut in as_completed(futures):
            n, ar = fut.result()
            if ar:
                texts[str(n)] = ar
            done += 1
            if done % 500 == 0:
                print(f"   scraped {done:,}/{total:,}", flush=True)

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(texts, f, ensure_ascii=False)
    return texts


def main():
    report_path = os.path.join("data", "iub_alignment_report.json")
    if not os.path.exists(report_path):
        sys.exit(f"ERROR: {report_path} not found. Run probe_alignment.py first.")
    report = json.load(open(report_path, encoding="utf-8"))

    qualifying = {slug: r for slug, r in report.items() if r["status"] == "RECOVERABLE"}
    excluded = {slug: r for slug, r in report.items() if r["status"] == "EXCLUDED"}
    unaligned = {slug: r["status"] for slug, r in report.items()
                 if slug not in qualifying and slug not in excluded}

    print(f"=== Building book indexes for {len(qualifying)} qualifying books ===", flush=True)
    if excluded:
        print(f"Excluded (no usable Arabic text in corpus): {', '.join(excluded)}", flush=True)
    if unaligned:
        print(f"Skipping (UNALIGNED, not force-mapped): {', '.join(unaligned)}\n", flush=True)

    total_match = total_no_match = 0

    for slug, r in qualifying.items():
        key = (r["path"], r["bookid"])
        info = IUB_REGISTRY[key]
        total = info["iub_total"]
        db_collection = info["db_collection"]
        print(f"\n--- {r['title']} ({slug}) match_rate={r.get('match_rate','?')} ---", flush=True)

        iub_texts = scrape_book_texts(r["path"], r["bookid"], slug, total)
        collection_texts = fetch_full_collection(
            db_collection, total + UPPER_BOUND_MARGIN,
            progress_label=f"{slug}: fetching {db_collection}",
        )
        # Tokenize once per collection entry and once per IUB hadith -- see
        # best_match_expanding's docstring: doing this inside the search loop
        # instead re-tokenizes the same text on every candidate checked,
        # which for a full book (thousands of hadith x up to a whole
        # collection of candidates each) hung the indexer for over an hour
        # past its DB fetch completing (confirmed live 2026-08-22, Bukhari).
        collection_tokens = tokenize_collection(collection_texts, content_tokens)

        matches = {}
        m_count = nm_count = 0
        done = 0
        for n_str, iub_text in iub_texts.items():
            n = int(n_str)
            query_tokens = content_tokens(iub_text)
            ratio, db_n = best_match_expanding(n, query_tokens, collection_tokens, token_overlap_ratio, OVERLAP_THRESHOLD)
            if ratio >= OVERLAP_THRESHOLD:
                matches[n_str] = {
                    "result": "MATCH",
                    "db_domain": collection_texts[db_n][0],
                    "db_hadith_number": db_n,
                    "ratio": round(ratio, 3),
                }
                m_count += 1
            else:
                matches[n_str] = {"result": "NO_MATCH", "ratio": round(ratio, 3)}
            done += 1
            if done % 1000 == 0:
                print(f"   matched {done:,}/{len(iub_texts):,}", flush=True)
                nm_count += 1

        out_file = os.path.join(INDEX_DIR, f"{slug}_matches.json")
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump({
                "slug": slug, "db_collection": db_collection,
                "path": r["path"], "bookid": r["bookid"],
                "total": total, "matches": matches,
            }, f, ensure_ascii=False, indent=2)

        print(f"   MATCH={m_count:,} NO_MATCH={nm_count:,} -> {out_file}", flush=True)
        total_match += m_count
        total_no_match += nm_count

    print(f"\n=== Totals: MATCH={total_match:,} NO_MATCH={total_no_match:,} ===", flush=True)


if __name__ == "__main__":
    main()
