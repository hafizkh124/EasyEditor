"""
apply_citation_urls.py - Phase E step 1.5 (the actual write).

Flags:
  --dry-run   (default) Print the per-book MATCH / MATCH_OFFSET / NO_MATCH /
              SKIPPED table and a small sample of what would be sent. Writes
              nothing, calls no backup.
  --book SLUG Restrict to one collection's *_matches.json.
  --apply     Run backup_citations.py fresh (so "the current run's backup"
              always exists and is never stale relative to what's about to be
              written -- the plan's stated safety requirement), then send the
              update-citation batches for real.

Only MATCH and MATCH_OFFSET(k) rows are ever written. NO_MATCH rows are left
completely untouched -- no fallback, no guessing.
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
    out = []
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
            print(f"   lookup batch failed at {i}: {e}", flush=True)
            continue
        out.extend(data.get("results", []))
    return out


def iub_url_for(path, bookid, hadith_number):
    return f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={hadith_number}"


def build_plan(book_filter=None):
    """Returns {slug: {"MATCH": n, "MATCH_OFFSET": n, "NO_MATCH": n, "SKIPPED": n,
    "updates": [ {passage_key, source_url, citation_ref_patch} ]}}"""
    plan = {}
    files = sorted(glob.glob(os.path.join(INDEX_DIR, "*_matches.json")))
    if not files:
        sys.exit(f"No *_matches.json files in {INDEX_DIR}. Run build_book_index.py first.")

    for path in files:
        data = json.load(open(path, encoding="utf-8"))
        slug = data["slug"]
        if book_filter and slug != book_filter:
            continue

        book_path, bookid = data["path"], data["bookid"]
        counts = {"MATCH": 0, "MATCH_OFFSET": 0, "NO_MATCH": 0, "SKIPPED": 0}

        # Resolve passage_key for every DB row we'd actually write to.
        target_pairs = []
        for n_str, m in data["matches"].items():
            n = int(n_str)
            if m["result"] == "MATCH":
                target_pairs.append((slug, n))
            elif m["result"].startswith("MATCH_OFFSET"):
                target_pairs.append((slug, m["db_hadith_number"]))

        resolved = {}
        if target_pairs:
            rows = lookup_full_rows(target_pairs)
            for r in rows:
                resolved[(r["collection"], int(r["hadith_number"]))] = r

        updates = []
        for n_str, m in data["matches"].items():
            n = int(n_str)
            result = m["result"]
            if result == "NO_MATCH":
                counts["NO_MATCH"] += 1
                continue

            if result == "MATCH":
                db_n = n
                counts["MATCH"] += 1
            else:
                db_n = m["db_hadith_number"]
                counts["MATCH_OFFSET"] += 1

            row = resolved.get((slug, db_n))
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
    print(f"\n{'book':30} {'MATCH':>8} {'MATCH_OFFSET':>13} {'NO_MATCH':>9} {'SKIPPED':>8} {'to_write':>9}")
    print("-" * 82)
    total = {"MATCH": 0, "MATCH_OFFSET": 0, "NO_MATCH": 0, "SKIPPED": 0, "to_write": 0}
    for slug, c in plan.items():
        to_write = len(c["updates"])
        print(f"{slug:30} {c['MATCH']:8,} {c['MATCH_OFFSET']:13,} {c['NO_MATCH']:9,} {c['SKIPPED']:8,} {to_write:9,}")
        total["MATCH"] += c["MATCH"]
        total["MATCH_OFFSET"] += c["MATCH_OFFSET"]
        total["NO_MATCH"] += c["NO_MATCH"]
        total["SKIPPED"] += c["SKIPPED"]
        total["to_write"] += to_write
    print("-" * 82)
    print(f"{'TOTAL':30} {total['MATCH']:8,} {total['MATCH_OFFSET']:13,} {total['NO_MATCH']:9,} {total['SKIPPED']:8,} {total['to_write']:9,}")
    return total


def send_updates(updates):
    ok = 0
    failed = 0
    for i in range(0, len(updates), UPDATE_BATCH):
        chunk = updates[i:i + UPDATE_BATCH]
        payload = json.dumps({"mode": "update-citation", "rows": chunk}).encode("utf-8")
        req = urllib.request.Request(
            f"{SUPABASE_URL}/functions/v1/ingest-batch",
            data=payload,
            headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                ok += data.get("updated", 0)
        except Exception as e:
            print(f"   update batch failed at {i}: {e}", flush=True)
            failed += len(chunk)
            continue
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
