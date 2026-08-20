"""
build_book_index.py - Phase E step 1.2: full-book verification for books the
alignment probe classified ALIGNED or OFFSET(k). UNALIGNED books are skipped
entirely and reported, never force-mapped.

For each qualifying book:
  1. Scrape EVERY hadith_number 1..total from IUB into
     data/iub_index/{slug}.json (hadith_number -> ar_fingerprint). This reuses
     client.py's on-disk cache, so a rerun after interruption costs nothing
     for pages already fetched -- the index file itself is also a durable
     asset once written.
  2. Read the DB's OWN ar_fingerprint for every hadith_number of that
     collection via the same lookup-citation RPC the alignment probe uses
     (scholarly_documents_lookup_by_citation), batched at ingest-batch's
     500-row cap. No new RPC needed.
  3. Classify each hadith_number:
       MATCH          -- iub_fp[n] == db_fp[n]
       MATCH_OFFSET(k) -- book has a detected offset k from the probe, and
                          iub_fp[n] == db_fp[n+k]
       NO_MATCH        -- neither; the existing citation is left untouched

Output: data/iub_index/{slug}_matches.json, one row per hadith_number with its
classification -- this is what apply_citation_urls.py reads to build the
actual update-citation payload.
"""

import os
import re
import sys
import json
import time
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.registry import IUB_REGISTRY
from scripts.iub.ar_normalize import ar_fingerprint
from scripts.iub.client import fetch_page
from scripts.iub.scrape_hadith import clean_html

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
SECRET = os.environ.get("INGEST_SHARED_SECRET")
if not SECRET:
    sys.exit("ERROR: INGEST_SHARED_SECRET is not set. Export it before running.")

INDEX_DIR = os.path.join("data", "iub_index")
os.makedirs(INDEX_DIR, exist_ok=True)

LOOKUP_BATCH = 200  # 500-row batches measured ~9s server-side, over the RPC default timeout; see 20260820010000_lookup_by_citation_timeout_fix.sql

RE_TASHKEEL = re.compile(r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>', re.DOTALL)
RE_ARABIC = re.compile(r'class=["\'][^"\']*hadith_arabic[^"\']*["\'][^>]*>(.*?)</div>', re.DOTALL)


def extract_arabic(html):
    matches = RE_TASHKEEL.findall(html) or RE_ARABIC.findall(html)
    return clean_html(" ".join(matches)) if matches else ""


def scrape_book_fingerprints(path, bookid, slug, total):
    out_file = os.path.join(INDEX_DIR, f"{slug}.json")
    if os.path.exists(out_file):
        with open(out_file, encoding="utf-8") as f:
            existing = json.load(f)
        if len(existing) >= total * 0.99:
            print(f"   Loaded existing index ({len(existing):,} entries), skipping scrape.", flush=True)
            return existing

    fps = {}
    for n in range(1, total + 1):
        url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={n}"
        html, is_missing, err = fetch_page(url, module=f"bookidx_{slug}", key=str(n))
        if html and not is_missing:
            ar = extract_arabic(html)
            if ar:
                fps[str(n)] = ar_fingerprint(ar)
        if n % 500 == 0:
            print(f"   scraped {n:,}/{total:,}", flush=True)

    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(fps, f)
    return fps


def db_fingerprints_for(slug, hadith_numbers):
    out = {}
    pairs = [(slug, n) for n in hadith_numbers]
    for i in range(0, len(pairs), LOOKUP_BATCH):
        chunk = pairs[i:i + LOOKUP_BATCH]
        rows = [{"collection": c, "hadith_number": str(n)} for c, n in chunk]
        payload = json.dumps({"mode": "lookup-citation", "rows": rows}).encode("utf-8")
        req = urllib.request.Request(
            f"{SUPABASE_URL}/functions/v1/ingest-batch",
            data=payload,
            headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"   db lookup batch failed at {i}: {e}", flush=True)
            continue
        for r in data.get("results", []):
            if r.get("ar_fingerprint"):
                out[r["hadith_number"]] = (r.get("domain"), r["ar_fingerprint"])
        print(f"   db fingerprints: {min(i+LOOKUP_BATCH, len(pairs)):,}/{len(pairs):,}", flush=True)
    return out


def parse_offset(status):
    if status == "ALIGNED":
        return 0
    m = re.match(r"OFFSET\((-?\d+)\)", status)
    return int(m.group(1)) if m else None


def main():
    report_path = os.path.join("data", "iub_alignment_report.json")
    if not os.path.exists(report_path):
        sys.exit(f"ERROR: {report_path} not found. Run probe_alignment.py first.")
    report = json.load(open(report_path, encoding="utf-8"))

    qualifying = {
        slug: r for slug, r in report.items()
        if r["status"] == "ALIGNED" or r["status"].startswith("OFFSET(")
    }
    skipped = {slug: r["status"] for slug, r in report.items() if slug not in qualifying}

    print(f"=== Building book indexes for {len(qualifying)} qualifying books ===", flush=True)
    if skipped:
        print(f"Skipping (UNALIGNED, not force-mapped): {', '.join(skipped)}\n", flush=True)

    total_match = total_offset_match = total_no_match = 0

    for slug, r in qualifying.items():
        key = (r["path"], r["bookid"])
        info = IUB_REGISTRY[key]
        total = info["iub_total"]
        offset_k = parse_offset(r["status"])
        print(f"\n--- {r['title']} ({slug}) status={r['status']} ---", flush=True)

        iub_fps = scrape_book_fingerprints(r["path"], r["bookid"], slug, total)

        # DB fingerprints needed: n itself (for MATCH), and n-offset_k (for
        # MATCH_OFFSET, since we compare iub_fp[n] to db_fp[n+offset_k], i.e.
        # need db rows at n+offset_k for every n in range).
        needed_numbers = set(int(n) for n in iub_fps)
        if offset_k:
            needed_numbers |= {n + offset_k for n in needed_numbers if 1 <= n + offset_k}
        db_fps = db_fingerprints_for(slug, sorted(needed_numbers))

        matches = {}
        m_count = mo_count = nm_count = 0
        for n_str, iub_fp in iub_fps.items():
            n = int(n_str)
            db_entry = db_fps.get(str(n))
            if db_entry and db_entry[1] == iub_fp:
                matches[n_str] = {"result": "MATCH", "db_domain": db_entry[0]}
                m_count += 1
                continue
            if offset_k:
                shifted_entry = db_fps.get(str(n + offset_k))
                if shifted_entry and shifted_entry[1] == iub_fp:
                    matches[n_str] = {
                        "result": f"MATCH_OFFSET({offset_k})",
                        "db_domain": shifted_entry[0],
                        "db_hadith_number": n + offset_k,
                    }
                    mo_count += 1
                    continue
            matches[n_str] = {"result": "NO_MATCH"}
            nm_count += 1

        out_file = os.path.join(INDEX_DIR, f"{slug}_matches.json")
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump({
                "slug": slug, "path": r["path"], "bookid": r["bookid"],
                "offset": offset_k, "total": total, "matches": matches,
            }, f, ensure_ascii=False, indent=2)

        print(f"   MATCH={m_count:,} MATCH_OFFSET={mo_count:,} NO_MATCH={nm_count:,} -> {out_file}", flush=True)
        total_match += m_count
        total_offset_match += mo_count
        total_no_match += nm_count

    print(f"\n=== Totals: MATCH={total_match:,} MATCH_OFFSET={total_offset_match:,} NO_MATCH={total_no_match:,} ===", flush=True)


if __name__ == "__main__":
    main()
