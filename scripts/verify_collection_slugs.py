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

This prints, for every slug in the registry, the live row count and how many of
those rows have Arabic matn, so both halves of the table can be re-checked:

    SUPABASE_SERVICE_ROLE_KEY=... python scripts/verify_collection_slugs.py

Add --list-unknown to also print collection strings that exist in the corpus but
are in no book's slug list (i.e. books a user still cannot scope to).

Read-only: it issues HEAD/count queries and never writes.
"""

import os
import re
import sys
import json
import urllib.parse
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

REGISTRY_TS = os.path.join("supabase", "functions", "_shared", "collections.ts")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Domains whose rows carry a `collection` — the same allowlist as
# scholarly_documents_lookup_by_citation and PSEUDO_DOMAIN_EXPANSION.
HADITH_DOMAINS = ["hadith-json", "urdu-hadith", "tohed-hadith", "easyquran-hadith",
                  "islamicurdubooks-hadith"]


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


def _get(path, params, extra_headers=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}?{urllib.parse.urlencode(params)}"
    headers = {"apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"}
    headers.update(extra_headers or {})
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=90) as resp:
        return resp


def count_rows(slug, arabic_only=False):
    params = {"citation_ref->>collection": f"eq.{slug}", "select": "id", "limit": "1"}
    if arabic_only:
        params["content_ar"] = "not.is.null"
    try:
        resp = _get("scholarly_documents", params, {"Prefer": "count=exact"})
        rng = resp.headers.get("Content-Range") or ""
        return int(rng.split("/")[1]) if "/" in rng else 0
    except Exception as exc:                                    # noqa: BLE001
        print(f"  ! query failed for {slug}: {exc}")
        return -1


def main():
    if not SERVICE_KEY:
        print("SUPABASE_SERVICE_ROLE_KEY is not set — this script needs it: the "
              "anon key is blocked by RLS on scholarly_documents and would "
              "report 0 rows for every slug, which looks exactly like a bad slug.")
        return 1

    books = parse_registry(REGISTRY_TS)
    print(f"Registry: {len(books)} books, {sum(len(slugs) for _, slugs, _ in books)} slugs\n")

    dead, live_slugs = [], set()
    for book_id, slugs, arabic_matn in books:
        parts, total = [], 0
        for slug in slugs:
            n = count_rows(slug)
            total += max(n, 0)
            if n > 0:
                live_slugs.add(slug)
                ar = count_rows(slug, arabic_only=True)
                parts.append(f"{slug}={n:,} (ar {ar:,})")
            else:
                parts.append(f"{slug}=0")
                dead.append((book_id, slug))
        flag = "" if total else "   <-- NO ROWS FOR THIS BOOK AT ALL"
        print(f"{book_id:32s} {'  '.join(parts)}{flag}")
        if total and arabic_matn and all(count_rows(s, arabic_only=True) == 0 for s in slugs):
            print(f"{'':32s} !! arabicMatn:true but no row has content_ar")

    print()
    if dead:
        print(f"{len(dead)} slug(s) matched zero rows (harmless if a sibling slug "
              f"covers the book, wrong if the book has none):")
        for book_id, slug in dead:
            print(f"  {book_id}: {slug}")
    else:
        print("Every slug in the registry matches at least one live row.")

    if "--list-unknown" in sys.argv:
        print("\nCollection strings in the corpus that no book claims:")
        try:
            resp = _get("scholarly_documents",
                        {"select": "citation_ref->collection", "domain": f"in.({','.join(HADITH_DOMAINS)})",
                         "limit": "100000"})
            seen = {row.get("collection") for row in json.loads(resp.read().decode())}
            unknown = sorted(c for c in seen if c and c not in live_slugs)
            for c in unknown:
                print(f"  {c}")
            if not unknown:
                print("  (none — every collection in the corpus is reachable)")
        except Exception as exc:                                # noqa: BLE001
            print(f"  ! could not enumerate collections: {exc}")

    return 1 if dead else 0


if __name__ == "__main__":
    sys.exit(main())
