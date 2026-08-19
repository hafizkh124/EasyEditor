import urllib.request
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://vdfdqtzndsrrlutbprtk.supabase.co"

queries = [
    ("انما الاعمال بالنيات", "hadith-index"),
    ("المستدرك على الصحيحين", "hadith-index"),
    ("الجامع الكامل", "hadith-index"),
]

for query, domain in queries:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/functions/v1/vector-search",
        data=json.dumps({"query": query, "limit": 3, "domain": domain}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            print(f"=== Query: '{query}' -> Found {len(results)} results ===")
            for idx, r in enumerate(results):
                cit = r.get("citation_ref") or {}
                book = cit.get("book") or "Unknown"
                hno = cit.get("hadith_number") or ""
                url = cit.get("url") or r.get("source_url") or ""
                dom = r.get("domain")
                print(f"  [{idx+1}] {book} #{hno} ({dom})")
                print(f"      URL: {url}")
            print()
    except Exception as e:
        print(f"Error querying '{query}': {e}\n")
