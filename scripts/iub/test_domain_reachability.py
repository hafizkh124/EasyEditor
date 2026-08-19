import urllib.request
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = "https://vdfdqtzndsrrlutbprtk.supabase.co"

tests = [
    {"domain": "islamicurdubooks-hadith", "query": "صلاة الجماعة تفضل على صلاة الفذ"},
    {"domain": "islamicurdubooks-rijal", "query": "ابن حجر ثقة حافظ"},
    {"domain": "islamicurdubooks-tafsir", "query": "تفسير سورة الفاتحة"},
]

for t in tests:
    req = urllib.request.Request(
        f"{SUPABASE_URL}/functions/v1/vector-search",
        data=json.dumps({"query": t["query"], "limit": 3, "domain": t["domain"]}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results = data.get("results", [])
            print(f"=== Domain: '{t['domain']}' | Query: '{t['query']}' -> {len(results)} results ===")
            for idx, r in enumerate(results):
                title = r.get("title") or ""
                cit = r.get("citation_ref") or {}
                url = cit.get("url") or r.get("source_url") or ""
                print(f"  [{idx+1}] Title: {title}")
                print(f"      URL: {url}")
            print()
    except Exception as e:
        print(f"Error querying '{t['domain']}': {e}\n")
