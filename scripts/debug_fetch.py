import urllib.request
import json
import re
import time

url = "https://tohed.com/hadith/ibn-khuzaimah/1/"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

for attempt in range(5):
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            html = resp.read().decode('utf-8', 'ignore')
            print(f"Success on attempt {attempt+1}! HTML length: {len(html)}")
            
            # Check json-ld
            json_ld_matches = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
            print(f"Found {len(json_ld_matches)} json-ld script tags")
            for i, jstr in enumerate(json_ld_matches):
                try:
                    jdata = json.loads(jstr)
                    print(f"  [{i}] @type: {jdata.get('@type')}")
                    if jdata.get("@type") == "Article":
                        print("  Headline:", jdata.get("headline")[:60])
                        print("  Body len:", len(jdata.get("articleBody", "")))
                except Exception as e:
                    print(f"  [{i}] JSON error: {e}")
                    
            # Let's check regex for ar and ur text blocks
            had_ur_matches = re.findall(r'<div class="had-ur">(.*?)</div>', html, re.DOTALL)
            print(f"Found {len(had_ur_matches)} <div class=\"had-ur\"> tags")
            for idx, h in enumerate(had_ur_matches[:5]):
                clean = re.sub(r'<[^>]+>', ' ', h).strip()
                print(f"  had-ur [{idx}] ({len(clean)} chars): {clean[:80]}...")
            break
    except Exception as e:
        print(f"Attempt {attempt+1} failed: {e}")
        time.sleep(2)
