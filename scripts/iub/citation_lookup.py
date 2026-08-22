"""
citation_lookup.py - shared Supabase lookup-citation client for Phase C/E,
replacing the old per-hadith +/-WINDOW lookup design.

fetch_full_collection() pulls every content_ar for a hadith collection in one
batched pass, keyed by hadith_number (str) -> (domain, content_ar).

Why: confirmed live on Sahih Bukhari (2026-08-21) that IUB-vs-hadith-json
numbering drifts LOCALLY and UNEVENLY through a single book, not by one
constant offset -- real matches were found at k = -257, -206, -37, -14, -4,
-1, 0, +1, +48, +104, +308, all within ONE book. A design that assumes "one
offset explains (nearly) all samples" (the original probe_alignment.py /
build_book_index.py approach) is fundamentally wrong for this corpus: no
single k reaches anywhere near the required consistency, so every book was
misclassified UNALIGNED regardless of how well it actually matches.

A fixed +/-50 or even +/-500 window has the same flaw at smaller scale --
it silently misses real matches sitting just outside the window (confirmed:
#906, #6946 needed k=+308/-257, both outside +/-50 but inside +/-500).

The fix: pull the WHOLE collection once (a constant ~40 batched requests for
a 7563-hadith book, independent of how many hadith_numbers are later
searched against it) and search it with NO offset assumption at all --
see best_match_expanding()'s docstring for the search strategy. This is also
far cheaper on the network than the old per-sample windowed-lookup design
(which needed a fresh ~101-pair request per sample and could never search
beyond its fixed radius), and was the direct cause of several
"read operation timed out" / dropped-request retries seen in that design
under real network conditions.
"""

import os
import json
import time
import urllib.request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
SECRET = os.environ.get("INGEST_SHARED_SECRET")
if not SECRET:
    raise RuntimeError("INGEST_SHARED_SECRET is not set. Export it before running.")

BATCH = 200  # 500-row batches measured ~9s server-side, over the RPC default timeout; see 20260820010000_lookup_by_citation_timeout_fix.sql


def _call(rows):
    payload = json.dumps({"mode": "lookup-citation", "rows": rows}).encode("utf-8")
    for attempt in range(4):
        req = urllib.request.Request(
            f"{SUPABASE_URL}/functions/v1/ingest-batch",
            data=payload,
            headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt < 3:
                print(f"   lookup-citation batch retry {attempt+1}/3: {e}", flush=True)
                time.sleep(3 + attempt * 3)
            else:
                print(f"   lookup-citation batch FAILED after retries: {e}", flush=True)
    return None


def fetch_full_collection(db_collection, upper_bound, progress_label=""):
    """Returns {hadith_number_str: (domain, content_ar)} for hadith_number in
    [1, upper_bound]. upper_bound should be the book's IUB total plus a
    generous margin (observed drift reached +308 on a 7563-hadith book) --
    getting this wrong only costs a few extra empty lookups, never
    correctness, since fetch_page-style local search never assumes a range."""
    out = {}
    numbers = list(range(1, upper_bound + 1))
    for i in range(0, len(numbers), BATCH):
        chunk = numbers[i:i + BATCH]
        rows = [{"collection": db_collection, "hadith_number": str(n)} for n in chunk]
        data = _call(rows)
        if data is None:
            continue
        for r in data.get("results", []):
            if r.get("content_ar"):
                out[r["hadith_number"]] = (r.get("domain"), r["content_ar"])
        if progress_label:
            print(f"   {progress_label}: {min(i + BATCH, len(numbers)):,}/{len(numbers):,}", flush=True)
    return out


def best_match_expanding(hno, text, collection_texts, content_overlap_ratio, threshold, radii=(50, 500)):
    """Search collection_texts for the best content-overlap match to `text`,
    trying successively wider radii around `hno` before falling back to a
    full scan. This keeps the common case (small or zero drift) fast while
    still catching the rare large jumps (+308 was observed) that a fixed
    window would silently miss. Returns (best_ratio, best_hadith_number_str).
    """
    best_ratio, best_n = 0.0, None
    tried = set()
    for radius in radii:
        lo, hi = max(1, hno - radius), hno + radius
        for n in range(lo, hi + 1):
            n_str = str(n)
            if n_str in tried:
                continue
            tried.add(n_str)
            entry = collection_texts.get(n_str)
            if entry:
                r = content_overlap_ratio(text, entry[1])
                if r > best_ratio:
                    best_ratio, best_n = r, n_str
        if best_ratio >= threshold:
            return best_ratio, best_n

    for n_str, entry in collection_texts.items():
        if n_str in tried:
            continue
        r = content_overlap_ratio(text, entry[1])
        if r > best_ratio:
            best_ratio, best_n = r, n_str
    return best_ratio, best_n
