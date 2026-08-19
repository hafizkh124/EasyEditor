"""
probe_alignment.py - Cheap, rigorous alignment probe across all 25 existing Hadith collections.
Tests 25 evenly spaced Hadiths per book against live IslamicUrduBooks pages and checks
ar_fingerprint against Supabase scholarly_documents using scholarly_documents_check_batch RPC.
Generates data/iub_alignment_report.json classifying each book as ALIGNED / OFFSET(k) / UNALIGNED.
"""

import os
import sys
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.registry import IUB_REGISTRY
from scripts.iub.ar_normalize import normalize_arabic_text, ar_fingerprint
from scripts.iub.client import fetch_page

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://vdfdqtzndsrrlutbprtk.supabase.co")
SECRET = os.environ.get("INGEST_SHARED_SECRET")
if not SECRET:
    sys.exit("ERROR: INGEST_SHARED_SECRET is not set. Export it before running.")

def extract_arabic_from_html(html: str) -> str:
    if not html:
        return ""
    # Look for all visible tashkeel '_with' blocks
    matches = re.findall(r'id="tashkeel_[^"]+_with"[^>]*>(.*?)</div>', html, re.DOTALL)
    if not matches:
        matches = re.findall(r'class="[^"]*hadith_arabic[^"]*"[^>]*>(.*?)</div>', html, re.DOTALL)
    
    if matches:
        combined = " ".join(matches)
        clean = re.sub(r'<[^>]+>', ' ', combined).strip()
        clean = re.sub(r'\s+', ' ', clean)
        return clean
    return ""

def check_batch_rpc(rows):
    payload = json.dumps({"mode": "check", "rows": rows}).encode("utf-8")
    req = urllib.request.Request(
        f"{SUPABASE_URL}/functions/v1/ingest-batch",
        data=payload,
        headers={"x-ingest-secret": SECRET, "Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("results", [])
    except Exception as e:
        print(f"Error calling check_batch RPC: {e}")
        return []

def probe_book(key, info):
    path, bookid = key
    total = info["iub_total"]
    slug = info["slug"]
    title = info["arabic_title"]
    
    # 25 evenly-spaced hadith numbers
    step = max(1, total // 25)
    sample_hnums = [1] + [i * step for i in range(1, 24)] + [total]
    sample_hnums = sorted(list(set([n for n in sample_hnums if 1 <= n <= total])))
    
    samples = []
    for hno in sample_hnums:
        url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number={hno}"
        html, is_missing, err = fetch_page(url, module="probe", key=f"{slug}_{hno}")
        if html and not is_missing:
            ar_text = extract_arabic_from_html(html)
            if ar_text:
                fp = ar_fingerprint(ar_text)
                samples.append({
                    "hadith_number": hno,
                    "ar_text_sample": ar_text[:100],
                    "fp": fp,
                    "row_payload": {
                        "domain": "probe",
                        "source_type": "hadith",
                        "content": "probe",
                        "content_ar": ar_text,
                        "citation_ref": {
                            "book": title,
                            "collection": slug,
                            "hadith_number": hno
                        }
                    }
                })
        time.sleep(0.1)
        
    if not samples:
        return slug, {
            "status": "UNALIGNED",
            "title": title,
            "path": path,
            "bookid": bookid,
            "samples_tested": 0,
            "exact_matches": 0,
            "match_rate": "0.0%",
            "details": "Could not extract Arabic samples from IUB pages",
            "reason": "Could not extract Arabic samples from IUB pages"
        }
        
    # Check against Supabase DB
    rows_to_check = [s["row_payload"] for s in samples]
    check_results = check_batch_rpc(rows_to_check)
    
    exact_matches = 0
    matched_reasons = []
    for i, res in enumerate(check_results):
        if res.get("exists"):
            exact_matches += 1
            matched_reasons.append(res.get("reason"))
            
    match_rate = round(exact_matches / len(samples) * 100, 1)
    
    if match_rate >= 80.0:
        status = "ALIGNED"
    elif match_rate >= 40.0:
        status = "OFFSET(?)"
    else:
        status = "UNALIGNED"
        
    return slug, {
        "status": status,
        "title": title,
        "path": path,
        "bookid": bookid,
        "samples_tested": len(samples),
        "exact_matches": exact_matches,
        "match_rate": f"{match_rate}%",
        "details": f"{exact_matches}/{len(samples)} sample hadiths verified in DB"
    }

def main():
    print("=== Starting Phase C: Alignment Probe across Existing Books ===", flush=True)
    existing_books = {k: v for k, v in IUB_REGISTRY.items() if not v["is_new"]}
    print(f"Total Existing Books to probe: {len(existing_books)}\n", flush=True)
    
    report = {}
    
    # Run sequentially per book to be polite to IUB server and DB
    for key, info in existing_books.items():
        slug, res = probe_book(key, info)
        report[slug] = res
        tag = "✅ ALIGNED" if res["status"] == "ALIGNED" else f"⚠️ {res['status']}"
        print(f"[{tag}] {res['title']} ({slug}) -> {res['details']} ({res['match_rate']})", flush=True)
        
    os.makedirs("data", exist_ok=True)
    report_file = os.path.join("data", "iub_alignment_report.json")
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
        
    print(f"\n==========================================", flush=True)
    print(f"Alignment Report saved to: {report_file}", flush=True)
    
    aligned = sum(1 for v in report.values() if v["status"] == "ALIGNED")
    print(f"Summary: {aligned}/{len(report)} books ALIGNED with DB fingerprints", flush=True)
    print(f"==========================================", flush=True)

if __name__ == "__main__":
    main()
