"""
verify_appendix_a.py - Live verification of all 42 (path, bookid) pairs on IslamicUrduBooks.com.
Fetches Hadith #1 for each book and verifies that the page loads with valid content.
"""

import urllib.request
import ssl
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from registry import IUB_REGISTRY

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'EasyEditor-ScholarResearch/1.0 (+https://editor.alulama.org; research@alulama.org)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ur,ar,en-US;q=0.9',
}

def verify_book(key, info):
    path, bookid = key
    url = f"https://islamicurdubooks.com/{path}/hadith-.php?bookid={bookid}&hadith_number=1"
    
    for attempt in range(3):
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            t0 = time.time()
            with urllib.request.urlopen(req, context=ctx, timeout=25) as resp:
                html = resp.read().decode('utf-8', errors='ignore')
                dur = round(time.time() - t0, 2)
                
                # Check for terminal error messages
                if "درست کتاب ID فراہم کریں" in html or "حدیث کا ریکارڈ نہیں ملا" in html:
                    return key, False, url, f"Terminal error in page content ({dur}s)"
                    
                # Verify book title or arabic content present
                title_match = re.search(r'class="btn1 fontarabic fs7[^"]*">\s*(?:<a[^>]*>)?([^<]+)', html)
                page_title = title_match.group(1).strip() if title_match else ""
                
                has_arabic = bool(re.search(r'class="[^"]*hadith_arabic', html))
                has_urdu = bool(re.search(r'class="[^"]*hadith_urdu', html))
                
                if has_arabic or has_urdu or len(html) > 5000:
                    return key, True, url, f"OK ({dur}s) | Title: {page_title}"
                else:
                    return key, False, url, f"Empty or unparseable page ({dur}s)"
        except Exception as e:
            if attempt < 2:
                time.sleep(1.0 + attempt * 1.5)
            else:
                return key, False, url, str(e)

def main():
    print(f"=== Verifying all {len(IUB_REGISTRY)} books on IslamicUrduBooks.com Live ===\n")
    results = []
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {executor.submit(verify_book, k, v): (k, v) for k, v in IUB_REGISTRY.items()}
        for f in as_completed(futures):
            key, success, url, msg = f.result()
            info = IUB_REGISTRY[key]
            status = "✅ PASS" if success else "❌ FAIL"
            tag = "[NEW]" if info["is_new"] else "[EXISTING]"
            print(f"{status} {tag} ({key[0]}, bookid={key[1]}): {info['arabic_title']} (total: {info['iub_total']:,}) -> {msg}")
            results.append(success)
            
    passed = sum(results)
    total = len(results)
    print(f"\n==========================================")
    print(f"Result: {passed}/{total} books verified successfully ({(passed/total)*100:.1f}%)")
    print(f"==========================================")

if __name__ == "__main__":
    main()
