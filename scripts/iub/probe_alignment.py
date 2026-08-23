"""
probe_alignment.py - Phase C: alignment probe across the 25 pre-existing
Hadith collections, deciding Part 1's (Phase E) scope.

For 25 evenly spaced hadith numbers per book, fetch the live IUB page and
search the DB's ENTIRE collection (not a fixed window) for the best
content-word-overlap match. See citation_lookup.py's module docstring for
why a fixed window / single global offset was tried first and abandoned:
confirmed live on Sahih Bukhari (2026-08-21) that IUB-vs-hadith-json
numbering drifts LOCALLY and UNEVENLY through one book -- real matches were
found at k = -257, -206, -37, -14, -4, -1, 0, +1, +48, +104, +308, all
within the SAME book. No single constant k, and no window smaller than the
whole collection, can be trusted to find them all.

Matching itself is by CONTENT-WORD OVERLAP RATIO, not exact fingerprint
equality -- see ar_normalize.py's content_overlap_ratio for why exact
md5(normalize_arabic_text(...)) equality fails here: hadith-json (and
presumably the other pre-existing domains) is independently digitized from
IUB, not derived from it, so isnad punctuation drifts unpredictably row to
row even when the underlying hadith text is identical.

This also carries a second, compounding fix: a page for a hadith that opens
a new bab often carries a PRECEDING epigraph block (a quoted Quran verse) in
its own tashkeel_..._with wrapper, labelled "حدیث نمبر: QN" instead of "N".
The original extraction grabbed every such wrapper on the page
indiscriminately, prepending the epigraph onto the real hadith text. Fixed
here by pairing each wrapper with its own "حدیث نمبر:" label and keeping
only the one whose label is the plain requested number -- see the matching
fix in scrape_hadith.py's parse_hadith_page, which had the identical bug and
affects already-ingested IUB rows, not just this probe.

Classification per book (RECOVERABLE, not ALIGNED/OFFSET/UNALIGNED -- there
is no single offset to report once matching searches the whole collection):
  RECOVERABLE -- >= MATCH_RATE_THRESHOLD of samples found a real match
                 somewhere in the collection
  UNALIGNED   -- fewer than that; book's content likely isn't in this domain
                 in a form word-overlap matching can find

Output: data/iub_alignment_report.json
"""

import os
import re
import sys
import json
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.registry import IUB_REGISTRY
from scripts.iub.ar_normalize import content_tokens, token_overlap_ratio
from scripts.iub.client import fetch_page
from scripts.iub.scrape_hadith import clean_html
from scripts.iub.citation_lookup import fetch_full_collection, tokenize_collection, best_match_expanding

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

OVERLAP_THRESHOLD = 0.6   # citationEngine.ts's takhrijHadith default is 0.5; a bit
                          # more margin here since this feeds a write path, and
                          # validated matches scored 0.94+ while mismatches scored <=0.11
MATCH_RATE_THRESHOLD = 0.75  # book-level: fraction of the 25 samples that must find
                              # a real match for the book to be worth a full index pass
UPPER_BOUND_MARGIN = 500     # observed max drift on Sahih Bukhari was +308; this
                              # margin covers that with room to spare


def extract_arabic_from_html(html: str, hno) -> str:
    """Same label-scoping fix as scrape_hadith.py's parse_hadith_page -- see
    module docstring. Falls back to the unscoped (all-wrappers) extraction
    only when no "حدیث نمبر:" labels are present at all."""
    if not html:
        return ""
    pat = re.compile(
        r'<span class="fontcalibri fs1 hno_color bold">([^<]+)</span>.*?'
        r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>',
        re.DOTALL,
    )
    pairs = pat.findall(html)
    target = str(hno)
    exact = [content for label, content in pairs if label.strip() == target]
    if exact:
        return clean_html(" ".join(exact))
    if pairs:
        return clean_html(" ".join(content for _, content in pairs))

    matches = re.findall(r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>', html, re.DOTALL)
    if not matches:
        matches = re.findall(r'class=["\'][^"\']*hadith_arabic[^"\']*["\'][^>]*>(.*?)</div>', html, re.DOTALL)
    return clean_html(" ".join(matches)) if matches else ""


def probe_book(key, info):
    path, bookid = key
    total = info["iub_total"]
    slug = info["slug"]
    db_collection = info["db_collection"]
    title = info["arabic_title"]

    step = max(1, total // 25)
    sample_hnums = sorted(set([1] + [i * step for i in range(1, 24)] + [total]))
    sample_hnums = [n for n in sample_hnums if 1 <= n <= total]

    # 1. Fetch IUB pages for the samples, extract Arabic text.
    iub_text = {}
    for hno in sample_hnums:
        url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={hno}"
        html, is_missing, err = fetch_page(url, module="probe", key=f"{slug}_{hno}")
        if html and not is_missing:
            ar_text = extract_arabic_from_html(html, hno)
            if ar_text:
                iub_text[hno] = ar_text
        time.sleep(0.05)

    if not iub_text:
        return slug, {
            "status": "UNALIGNED", "title": title, "path": path, "bookid": bookid,
            "samples_tested": 0, "reason": "Could not extract Arabic samples from IUB pages",
        }

    # 2. Pull the WHOLE db_collection once -- see citation_lookup.py's
    #    module docstring for why this replaced a per-sample windowed lookup.
    collection_texts = fetch_full_collection(
        db_collection, total + UPPER_BOUND_MARGIN,
        progress_label=f"{slug}: fetching {db_collection}",
    )
    # Tokenize once per collection entry and once per sample -- see
    # best_match_expanding's docstring: re-tokenizing raw text inside the
    # search loop redundantly re-runs the same regex work on every
    # candidate checked.
    collection_tokens = tokenize_collection(collection_texts, content_tokens)

    # 3. For each sample, search the whole collection for its best match.
    per_sample = {}
    matched_domain = None
    match_count = 0
    for hno, text in iub_text.items():
        query_tokens = content_tokens(text)
        ratio, db_n = best_match_expanding(hno, query_tokens, collection_tokens, token_overlap_ratio, OVERLAP_THRESHOLD)
        is_match = ratio >= OVERLAP_THRESHOLD
        if is_match:
            match_count += 1
            matched_domain = matched_domain or collection_texts[db_n][0]
        per_sample[str(hno)] = {"ratio": round(ratio, 3), "db_hadith_number": db_n, "match": is_match}

    samples_tested = len(iub_text)
    match_rate = round(match_count / samples_tested * 100, 1)
    status = "RECOVERABLE" if (match_count / samples_tested) >= MATCH_RATE_THRESHOLD else "UNALIGNED"

    return slug, {
        "status": status,
        "title": title,
        "path": path,
        "bookid": bookid,
        "db_collection": db_collection,
        "samples_tested": samples_tested,
        "matches": match_count,
        "match_rate": f"{match_rate}%",
        "matched_domain": matched_domain,
        "per_sample": per_sample,
        "details": f"{match_count}/{samples_tested} samples matched somewhere in {db_collection}",
    }


def main():
    print("=== Phase C: Alignment Probe (25 existing books) ===", flush=True)
    all_existing = {k: v for k, v in IUB_REGISTRY.items() if not v["is_new"]}
    viable = {k: v for k, v in all_existing.items() if v.get("db_collection")}
    excluded = {k: v for k, v in all_existing.items() if not v.get("db_collection")}
    print(f"Books to probe: {len(viable)}  (excluded: {len(excluded)} -- see below)\n", flush=True)

    os.makedirs("data", exist_ok=True)
    report_file = os.path.join("data", "iub_alignment_report.json")

    def checkpoint():
        with open(report_file, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)

    report = {}
    for key, info in excluded.items():
        print(f"[EXCLUDED    ] {info['arabic_title']} ({info['slug']}) -> {info['db_exclude_reason']}", flush=True)
        report[info["slug"]] = {
            "status": "EXCLUDED",
            "title": info["arabic_title"],
            "path": key[0],
            "bookid": key[1],
            "reason": info["db_exclude_reason"],
        }
    checkpoint()
    print()

    for key, info in viable.items():
        slug, res = probe_book(key, info)
        report[slug] = res
        checkpoint()  # write after every book -- a run that gets killed mid-way (session
                       # teardown, network outage) still leaves every finished book's full
                       # per_sample data on disk instead of losing the whole run.
        print(f"[{res['status']:12}] {res['title']} ({slug}) -> {res.get('details','')} ({res.get('match_rate','?')})", flush=True)

    aligned = sum(1 for v in report.values() if v["status"] == "RECOVERABLE")
    unaligned = sum(1 for v in report.values() if v["status"] == "UNALIGNED")
    excl = sum(1 for v in report.values() if v["status"] == "EXCLUDED")
    print(f"\n=== Summary: {aligned} RECOVERABLE, {unaligned} UNALIGNED, {excl} EXCLUDED (of {len(report)}) ===", flush=True)
    print(f"Report: {report_file}", flush=True)


if __name__ == "__main__":
    main()
