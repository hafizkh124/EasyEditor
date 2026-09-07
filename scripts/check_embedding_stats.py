import os
import sys
import json
import urllib.request

# Reconfigure stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# SPEC M10 §5.0 — this used to fall back to a hardcoded service_role key
# (revoke that key and rotate a new one before running this script again).
# Both values are now required from the environment; there is no default and
# no key is committed to source control.
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_KEY:
    print(
        "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment "
        "before running this script (no default is provided on purpose).",
        file=sys.stderr,
    )
    sys.exit(1)

headers = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
}

def query_count(query_str):
    url = f"{SUPABASE_URL}/rest/v1/scholarly_documents?{query_str}&select=count"
    req = urllib.request.Request(url, headers={**headers, "Prefer": "count=exact"})
    try:
        with urllib.request.urlopen(req) as resp:
            content_range = resp.headers.get("Content-Range")
            if content_range and "/" in content_range:
                return int(content_range.split("/")[1])
    except Exception as e:
        print(f"Error querying {query_str}: {e}")
    return 0

def main():
    total_docs = query_count("select=id")
    with_embeddings = query_count("embedding=not.is.null")
    without_embeddings = query_count("embedding=is.null")
    
    quran_total = query_count("source_type=eq.quran")
    quran_embedded = query_count("source_type=eq.quran&embedding=not.is.null")
    
    hadith_total = query_count("source_type=eq.hadith")
    hadith_embedded = query_count("source_type=eq.hadith&embedding=not.is.null")

    tohed_total = query_count("domain=eq.tohed-hadith")
    tohed_embedded = query_count("domain=eq.tohed-hadith&embedding=not.is.null")
    
    print(f"=== Scholarly Documents Embedding Stats ===")
    print(f"Total Documents in DB: {total_docs:,}")
    print(f"Total with Vector Embeddings: {with_embeddings:,} ({with_embeddings/total_docs*100:.1f}%)" if total_docs else "")
    print(f"Total Pending Embeddings: {without_embeddings:,}")
    print("\nBreakdown:")
    print(f"  Quran: {quran_embedded:,} / {quran_total:,} embedded ({quran_embedded/quran_total*100:.1f}%)" if quran_total else "")
    print(f"  Hadith (Combined): {hadith_embedded:,} / {hadith_total:,} embedded ({hadith_embedded/hadith_total*100:.1f}%)" if hadith_total else "")
    print(f"  Tohed.com Hadith: {tohed_embedded:,} / {tohed_total:,} embedded ({tohed_embedded/tohed_total*100:.1f}%)" if tohed_total else "")

if __name__ == "__main__":
    main()
