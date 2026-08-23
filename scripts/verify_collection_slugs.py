#!/usr/bin/env python3
"""
verify_collection_slugs.py - check the collection registry against the live corpus.

`supabase/functions/_shared/collections.ts` maps a canonical book id to every
string that book is stored under in `citation_ref->>'collection'`. Those strings
were assembled from in-repo evidence (the ingestion scripts, scripts/iub/
registry.py's live-discovered db_collection values, and a live pull of 33,080
rows in data/citation_backup_20260823_141244.csv) — but only the database can
confirm them, and a slug that matches nothing fails SILENTLY: the user asks for
one book, the scope filter matches zero rows, and the answer comes back empty.

Uses `ingest-batch`'s `lookup-citation` mode (the same INGEST_SHARED_SECRET
already used throughout Phase E) rather than SUPABASE_SERVICE_ROLE_KEY, since
the service key on file is rotated/401 and the anon key is RLS-blocked on
scholarly_documents (returns 0 rows either way, indistinguishable from a
genuinely bad slug). That RPC is an EXACT (collection, hadith_number) lookup,
not a count -- so this checks existence, not row totals: for each slug, it
tries a spread of hadith_number values (not just "1", since IUB-derived
collections can start at an offset) and reports the first one that resolves,
with whether that row has content_ar.

    python scripts/verify_collection_slugs.py

Add --list-unknown to also fetch a handful of (collection, hadith_number)
pairs for known dead slugs' neighboring domains, as a sanity spot-check.

Read-only: it only ever calls lookup-citation, which never writes.
"""

import os
import re
import sys
import json
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REGISTRY_TS = os.path.join("supabase", "functions", "_shared", "collections.ts")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
SECRET = os.environ.get("INGEST_SHARED_SECRET", "")

# Spread of hadith_numbers to probe per slug -- covers both 1-based
# collections and IUB-derived ones that can start at a local offset.
PROBE_NUMBERS = [1, 2, 3, 5, 10, 50, 100, 200, 500]


def parse_registry(path):
    """(id, [slugs], arabicMatn) per book, in file order.

    Deliberately a regex over the source rather than a TS import: this script
    has to run from a bare Python install with no Node/Deno toolchain.
    """
    src = open(path, encoding="utf-8").read()
    body = src[src.index("export const CORPUS_BOOKS"):src.index("export const BOOK_IDS")]
    books = []
    for block in re.finditer(
        r'\{\s*id:\s*"([^"]+)".*?slugs:\s*\[(.*?)\].*?arabicMatn:\s*(true|false)',
        body, re.DOTALL,
    ):
        book_id, slugs_raw, arabic = block.groups()
        slugs = re.findall(r'"([^"]+)"', slugs_raw)
        books.append((book_id, slugs, arabic == "true"))
    return books


def lookup_batch(pairs):
    """pairs: list of (collection, hadith_number) -> {(collection, hadith_number): row}"""
    if not pairs:
        return {}
    rows = [{"collection": c, "hadith_number": str(n)} for c, n in pairs]
    payload = json.dumps({"mode": "lookup-citation", "rows": rows}).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/functions/v1/ingest-batch",
        data=payload,
        headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    out = {}
    for r in data.get("results", []):
        if r.get("id"):
            out[(r["collection"], r["hadith_number"])] = r
    return out


def probe_slug(slug):
    """Returns (found: bool, hadith_number_that_matched, has_content_ar) for one slug."""
    pairs = [(slug, n) for n in PROBE_NUMBERS]
    resolved = lookup_batch(pairs)
    for n in PROBE_NUMBERS:
        row = resolved.get((slug, str(n)))
        if row:
            return True, n, bool(row.get("content_ar"))
    return False, None, False


def main():
    if not SECRET:
        print("INGEST_SHARED_SECRET is not set. Export it (from .env) before running:")
        print('  export INGEST_SHARED_SECRET=$(grep "^INGEST_SHARED_SECRET=" .env | cut -d= -f2- | sed \'s/^"//;s/"$//\')')
        return 1

    books = parse_registry(REGISTRY_TS)
    print(f"Registry: {len(books)} books, {sum(len(slugs) for _, slugs, _ in books)} slugs\n")

    dead = []
    for book_id, slugs, arabic_matn in books:
        parts, any_live, any_ar = [], False, False
        for slug in slugs:
            found, n, has_ar = probe_slug(slug)
            if found:
                any_live = True
                any_ar = any_ar or has_ar
                parts.append(f"{slug}=live@#{n}{' (ar)' if has_ar else ' (no ar)'}")
            else:
                parts.append(f"{slug}=NOT FOUND in {PROBE_NUMBERS}")
                dead.append((book_id, slug))
        flag = "" if any_live else "   <-- NO SLUG RESOLVED FOR THIS BOOK AT ALL"
        print(f"{book_id:32s} {'  '.join(parts)}{flag}")
        if any_live and arabic_matn and not any_ar:
            print(f"{'':32s} !! arabicMatn:true but no probed row has content_ar")

    print()
    if dead:
        print(f"{len(dead)} slug(s) had no match at any probed hadith_number "
              f"(harmless if a sibling slug covers the book; also possible the "
              f"book's true numbering falls entirely outside {PROBE_NUMBERS} -- "
              f"widen the probe list for those before concluding the slug is dead):")
        for book_id, slug in dead:
            print(f"  {book_id}: {slug}")
    else:
        print("Every slug in the registry resolved at least one probed hadith_number.")

    return 1 if dead else 0


if __name__ == "__main__":
    sys.exit(main())
