"""
apply_citation_urls.py - Phase E step 1.5 (the actual write).

Flags:
  --dry-run   (default) Print the per-book MATCH / NO_MATCH / SKIPPED table
              and a small sample of what would be sent. Writes nothing,
              calls no backup.
  --book SLUG Restrict to one collection's *_matches.json.
  --apply     Run backup_citations.py fresh (so "the current run's backup"
              always exists and is never stale relative to what's about to be
              written -- the plan's stated safety requirement), then send the
              update-citation batches for real.

Only MATCH rows are ever written. NO_MATCH rows are left completely
untouched -- no fallback, no guessing. Each MATCH row carries its own
db_hadith_number (build_book_index.py's citation_lookup-based whole-collection
search finds the true DB row per hadith, which can differ from the IUB number
by any local amount -- there is no book-wide constant offset; see
citation_lookup.py's module docstring).
"""

import os
import re
import sys
import json
import time
import glob
import argparse
import urllib.request

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
SECRET = os.environ.get("INGEST_SHARED_SECRET")
if not SECRET:
    sys.exit("ERROR: INGEST_SHARED_SECRET is not set. Export it before running.")

INDEX_DIR = os.path.join("data", "iub_index")
LOOKUP_BATCH = 200  # 500-row batches measured ~9s server-side, over the RPC default timeout; see 20260820010000_lookup_by_citation_timeout_fix.sql
UPDATE_BATCH = 500


def lookup_full_rows(pairs):
    """Retries each chunk on failure -- a dropped chunk here means those rows'
    passage_key never resolves, so build_plan() would count them SKIPPED
    (excluded from the write) instead of actually writing them, purely
    because of a transient network/server hiccup rather than a real problem
    with the row."""
    out = []
    for i in range(0, len(pairs), LOOKUP_BATCH):
        chunk = pairs[i:i + LOOKUP_BATCH]
        rows = [{"collection": c, "hadith_number": str(n)} for c, n in chunk]
        payload = json.dumps({"mode": "lookup-citation", "rows": rows}).encode("utf-8")
        data = None
        for attempt in range(4):
            req = urllib.request.Request(
                f"{SUPABASE_URL}/functions/v1/ingest-batch",
                data=payload,
                headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                break
            except Exception as e:
                if attempt < 3:
                    print(f"   lookup batch retry {attempt+1}/3 at {i}: {e}", flush=True)
                    time.sleep(3 + attempt * 3)
                else:
                    print(f"   lookup batch FAILED after retries at {i}: {e}", flush=True)
        if data is None:
            continue
        out.extend(data.get("results", []))
    return out


def iub_url_for(path, bookid, hadith_number):
    return f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={hadith_number}"


def build_plan(book_filter=None):
    """Returns {slug: {"MATCH": n, "NO_MATCH": n, "SKIPPED": n,
    "updates": [ {passage_key, source_url, citation_ref_patch} ]}}"""
    plan = {}
    files = sorted(glob.glob(os.path.join(INDEX_DIR, "*_matches.json")))
    if not files:
        sys.exit(f"No *_matches.json files in {INDEX_DIR}. Run build_book_index.py first.")

    for path in files:
        data = json.load(open(path, encoding="utf-8"))
        slug = data["slug"]
        db_collection = data["db_collection"]
        if book_filter and slug != book_filter:
            continue

        book_path, bookid = data["path"], data["bookid"]
        counts = {"MATCH": 0, "NO_MATCH": 0, "DUPLICATE": 0, "SKIPPED": 0}

        # Multiple IUB hadith_numbers can land on the SAME db_hadith_number
        # as their best match -- confirmed live (2026-08-23): summing raw
        # MATCH rows across all 11 books gives 37,055, but only ~33,080
        # distinct (db_collection, db_hadith_number) targets exist. This is
        # almost always a genuine repeated narration (e.g. Bukhari's
        # mukarrarat -- the same hadith text cited verbatim across several
        # chapters), not a bug in the matching itself. Only ONE citation can
        # ever be written to a given DB row, so pick the HIGHEST-ratio match
        # as the canonical one per row -- an earlier version of this
        # function appended one update per IUB hadith_number unconditionally,
        # which would have sent multiple conflicting updates for the same
        # passage_key in a single apply run, with whichever happened to
        # process last (an accident of dict iteration order, not a
        # deliberate choice) silently overwriting the rest.
        best_by_db_n = {}
        for n_str, m in data["matches"].items():
            if m["result"] != "MATCH":
                counts["NO_MATCH"] += 1
                continue
            counts["MATCH"] += 1
            db_n = int(m["db_hadith_number"])
            n = int(n_str)
            ratio = m.get("ratio", 0.0)
            if db_n not in best_by_db_n or ratio > best_by_db_n[db_n][1]:
                if db_n in best_by_db_n:
                    counts["DUPLICATE"] += 1
                best_by_db_n[db_n] = (n, ratio)
            else:
                counts["DUPLICATE"] += 1

        # Resolve passage_key for every DB row we'd actually write to. Keyed
        # on db_collection -- the corpus's real citation_ref.collection value,
        # not the IUB registry slug (they differ for most of these 25 books;
        # see registry.py's module docstring).
        target_pairs = [(db_collection, db_n) for db_n in best_by_db_n]
        resolved = {}
        if target_pairs:
            rows = lookup_full_rows(target_pairs)
            for r in rows:
                resolved[(r["collection"], int(r["hadith_number"]))] = r

        updates = []
        for db_n, (n, ratio) in best_by_db_n.items():
            row = resolved.get((db_collection, db_n))
            if not row or not row.get("passage_key"):
                counts["SKIPPED"] += 1
                continue

            new_url = iub_url_for(book_path, bookid, n)
            updates.append({
                "passage_key": row["passage_key"],
                "source_url": new_url,
                "citation_ref_patch": {
                    "iub_url": new_url,
                    "iub_bookid": bookid,
                    "iub_path": book_path,
                    "iub_hadith_number": n,
                    "iub_verified_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
            })

        plan[slug] = {**counts, "updates": updates}

    return plan


def print_table(plan):
    print(f"\n{'book':30} {'MATCH':>8} {'NO_MATCH':>9} {'DUPLICATE':>10} {'SKIPPED':>8} {'to_write':>9}")
    print("-" * 82)
    total = {"MATCH": 0, "NO_MATCH": 0, "DUPLICATE": 0, "SKIPPED": 0, "to_write": 0}
    for slug, c in plan.items():
        to_write = len(c["updates"])
        print(f"{slug:30} {c['MATCH']:8,} {c['NO_MATCH']:9,} {c['DUPLICATE']:10,} {c['SKIPPED']:8,} {to_write:9,}")
        total["MATCH"] += c["MATCH"]
        total["NO_MATCH"] += c["NO_MATCH"]
        total["DUPLICATE"] += c["DUPLICATE"]
        total["SKIPPED"] += c["SKIPPED"]
        total["to_write"] += to_write
    print("-" * 82)
    print(f"{'TOTAL':30} {total['MATCH']:8,} {total['NO_MATCH']:9,} {total['DUPLICATE']:10,} {total['SKIPPED']:8,} {total['to_write']:9,}")
    return total


def send_updates(updates):
    ok = 0
    failed = 0
    for i in range(0, len(updates), UPDATE_BATCH):
        chunk = updates[i:i + UPDATE_BATCH]
        payload = json.dumps({"mode": "update-citation", "rows": chunk}).encode("utf-8")
        data = None
        for attempt in range(4):
            req = urllib.request.Request(
                f"{SUPABASE_URL}/functions/v1/ingest-batch",
                data=payload,
                headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                break
            except Exception as e:
                if attempt < 3:
                    print(f"   update batch retry {attempt+1}/3 at {i}: {e}", flush=True)
                    time.sleep(3 + attempt * 3)
                else:
                    print(f"   update batch FAILED after retries at {i}: {e}", flush=True)
        if data is None:
            failed += len(chunk)
            continue
        ok += data.get("updated", 0)
        print(f"   updated {min(i+UPDATE_BATCH, len(updates)):,}/{len(updates):,} "
              f"(running total ok={ok:,})", flush=True)
    return ok, failed


def main():
    parser = argparse.ArgumentParser(description="Phase E apply: write verified IUB citations")
    parser.add_argument("--book", type=str, help="Restrict to one collection slug")
    parser.add_argument("--apply", action="store_true", help="Actually write (default is dry-run)")
    args = parser.parse_args()

    plan = build_plan(book_filter=args.book)
    total = print_table(plan)

    if not args.apply:
        print("\n(dry-run -- pass --apply to write. A fresh backup is taken automatically before writing.)")
        if total["to_write"] > 0:
            sample_slug, sample_book = next((s, b) for s, b in plan.items() if b["updates"])
            print(f"\nSample update payload ({sample_slug}):")
            print(json.dumps(sample_book["updates"][0], ensure_ascii=False, indent=2))
        return

    if total["to_write"] == 0:
        print("\nNothing to write.")
        return

    print(f"\n=== Backing up {total['to_write']:,} rows before writing ===", flush=True)
    import scripts.iub.backup_citations as backup_mod
    backup_mod.main()

    # Refuse to proceed if backup_citations.py didn't actually leave a fresh
    # manifest behind (e.g. it exited early because there was nothing to
    # resolve) -- this is the "won't run without this run's backup" gate.
    manifests = sorted(glob.glob(os.path.join("data", "citation_backup_*.manifest.json")))
    if not manifests:
        sys.exit("ERROR: no backup manifest found after running backup_citations.py -- refusing to apply.")
    latest = json.load(open(manifests[-1], encoding="utf-8"))
    if latest["rows_backed_up"] < total["to_write"] * 0.99:
        sys.exit(
            f"ERROR: backup only covered {latest['rows_backed_up']:,} of {total['to_write']:,} "
            f"planned rows -- refusing to apply. Investigate before retrying."
        )
    print(f"Backup confirmed: {latest['rows_backed_up']:,} rows in {latest['backup_csv']}\n", flush=True)

    print(f"=== Applying {total['to_write']:,} citation updates ===", flush=True)
    for slug, c in plan.items():
        if not c["updates"]:
            continue
        print(f"\n--- {slug}: {len(c['updates']):,} rows ---", flush=True)
        ok, failed = send_updates(c["updates"])
        print(f"   {slug}: {ok:,} updated, {failed:,} failed", flush=True)


if __name__ == "__main__":
    main()
