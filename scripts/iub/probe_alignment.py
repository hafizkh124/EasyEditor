"""
probe_alignment.py - Phase C: alignment probe across the 25 pre-existing
Hadith collections, deciding Part 1's (Phase E) scope.

For 25 evenly spaced hadith numbers per book, fetch the live IUB page,
compute its normalized Arabic fingerprint, and compare it against the
EXISTING DB row's OWN fingerprint at that same (collection, hadith_number) --
and, if that doesn't match, search a +/-50 window for a constant offset.

This replaces an earlier version of this script that fed scraped text into
scholarly_documents_check_batch under a fake domain='probe'. That RPC's
ar_fingerprint branch is a CORPUS-WIDE existence check ("does this wording
exist anywhere, in any collection"), not scoped to the target book -- so it
would report high "alignment" purely from cross-collection hadith repetition
(the same hadith narrated in Bukhari, Muslim, Abu Dawud, ... with identical
wording) even for a book whose own Tohed-vs-IUB numbering is completely
unrelated. See scholarly_documents_lookup_by_citation's comment in
20260820000000_citation_remap_rpcs.sql for the full reasoning. This version
uses that new RPC (via ingest-batch mode="lookup-citation"), which looks up
the EXISTING row's fingerprint for the EXACT (collection, hadith_number)
pair -- an apples-to-apples comparison.

Classification per book:
  ALIGNED     -- all (or nearly all) samples match at offset 0
  OFFSET(k)   -- all (or nearly all) samples match at one constant k != 0
  UNALIGNED   -- no consistent single offset explains the samples

Output: data/iub_alignment_report.json
"""

import os
import re
import sys
import json
import time
import urllib.request
from collections import Counter

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

WINDOW = 50   # search hadith_number +/- this many for a constant offset
LOOKUP_BATCH = 500  # ingest-batch's per-call row cap


def extract_arabic_from_html(html: str) -> str:
    if not html:
        return ""
    matches = re.findall(r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>', html, re.DOTALL)
    if not matches:
        # Quote style is inconsistent across pages -- see the same fix in
        # scrape_hadith.py's _class_matches helper.
        matches = re.findall(r'class=["\'][^"\']*hadith_arabic[^"\']*["\'][^>]*>(.*?)</div>', html, re.DOTALL)
    if not matches:
        return ""
    return clean_html(" ".join(matches))


def lookup_citation_batch(pairs):
    """pairs: list of (collection, hadith_number) -> {(collection,hadith_number): (domain, ar_fingerprint)}"""
    out = {}
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
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"   lookup-citation batch failed: {e}", flush=True)
            continue
        for r in data.get("results", []):
            key = (r["collection"], r["hadith_number"])
            if r.get("ar_fingerprint"):
                out[key] = (r.get("domain"), r["ar_fingerprint"])
    return out


def probe_book(key, info):
    path, bookid = key
    total = info["iub_total"]
    slug = info["slug"]
    title = info["arabic_title"]

    step = max(1, total // 25)
    sample_hnums = sorted(set([1] + [i * step for i in range(1, 24)] + [total]))
    sample_hnums = [n for n in sample_hnums if 1 <= n <= total]

    # 1. Fetch IUB pages for the samples, compute fingerprints.
    iub_fp = {}
    for hno in sample_hnums:
        url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={hno}"
        html, is_missing, err = fetch_page(url, module="probe", key=f"{slug}_{hno}")
        if html and not is_missing:
            ar_text = extract_arabic_from_html(html)
            if ar_text:
                iub_fp[hno] = ar_fingerprint(ar_text)
        time.sleep(0.05)

    if not iub_fp:
        return slug, {
            "status": "UNALIGNED", "title": title, "path": path, "bookid": bookid,
            "samples_tested": 0, "reason": "Could not extract Arabic samples from IUB pages",
        }

    # 2. For each sample, batch-lookup DB fingerprints for hadith_number in
    #    [N-WINDOW, N+WINDOW] (clamped to the book's real range), all under
    #    this book's own citation_ref.collection.
    all_pairs = []
    for hno in iub_fp:
        lo, hi = max(1, hno - WINDOW), min(total, hno + WINDOW)
        for n in range(lo, hi + 1):
            all_pairs.append((slug, n))
    db_fp = lookup_citation_batch(all_pairs)

    # 3. For each sample, find every offset k in [-WINDOW, WINDOW] where
    #    iub_fp[hno] matches db_fp[(slug, hno+k)].
    per_sample_offsets = {}
    matched_domain = None
    for hno, fp in iub_fp.items():
        offsets_here = []
        for k in range(-WINDOW, WINDOW + 1):
            n = hno + k
            entry = db_fp.get((slug, n))
            if entry and entry[1] == fp:
                offsets_here.append(k)
                matched_domain = matched_domain or entry[0]
        per_sample_offsets[hno] = offsets_here

    # 4. A book is ALIGNED/OFFSET(k) only if ONE constant k explains
    #    (nearly) all samples -- not just "some offset matched somewhere",
    #    which would be as meaningless as the corpus-wide check this replaced.
    offset_votes = Counter()
    for hno, offsets in per_sample_offsets.items():
        for k in offsets:
            offset_votes[k] += 1

    samples_tested = len(iub_fp)
    if offset_votes:
        best_k, best_count = offset_votes.most_common(1)[0]
        match_rate = round(best_count / samples_tested * 100, 1)
    else:
        best_k, best_count, match_rate = None, 0, 0.0

    if match_rate >= 92.0 and best_k == 0:
        status = "ALIGNED"
    elif match_rate >= 92.0 and best_k != 0:
        status = f"OFFSET({best_k})"
    else:
        status = "UNALIGNED"

    return slug, {
        "status": status,
        "title": title,
        "path": path,
        "bookid": bookid,
        "samples_tested": samples_tested,
        "best_offset": best_k,
        "matches_at_best_offset": best_count,
        "match_rate": f"{match_rate}%",
        "matched_domain": matched_domain,
        "per_sample_offsets": {str(k): v for k, v in per_sample_offsets.items()},
        "details": f"{best_count}/{samples_tested} samples consistent at offset {best_k}" if offset_votes
                   else "No sample matched any DB fingerprint in the +/-50 window",
    }


def main():
    print("=== Phase C: Alignment Probe (25 existing books) ===", flush=True)
    existing_books = {k: v for k, v in IUB_REGISTRY.items() if not v["is_new"]}
    print(f"Books to probe: {len(existing_books)}\n", flush=True)

    report = {}
    for key, info in existing_books.items():
        slug, res = probe_book(key, info)
        report[slug] = res
        print(f"[{res['status']:12}] {res['title']} ({slug}) -> {res.get('details','')} ({res.get('match_rate','?')})", flush=True)

    os.makedirs("data", exist_ok=True)
    report_file = os.path.join("data", "iub_alignment_report.json")
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    aligned = sum(1 for v in report.values() if v["status"] == "ALIGNED")
    offset = sum(1 for v in report.values() if v["status"].startswith("OFFSET"))
    unaligned = sum(1 for v in report.values() if v["status"] == "UNALIGNED")
    print(f"\n=== Summary: {aligned} ALIGNED, {offset} OFFSET, {unaligned} UNALIGNED (of {len(report)}) ===", flush=True)
    print(f"Report: {report_file}", flush=True)


if __name__ == "__main__":
    main()
