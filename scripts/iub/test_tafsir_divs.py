import urllib.request, ssl, re, sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {'User-Agent': 'EasyEditor-ScholarResearch/1.0'}

url = "https://islamicurdubooks.com/quran/tafseer_ibn_kaseer.php?faayat_id=1"
req = urllib.request.Request(url, headers=HEADERS)
with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Find all divs with their classes
divs = re.findall(r'<div([^>]*)>(.*?)</div>', html, re.DOTALL)
for attr, content in divs:
    clean = re.sub(r'<[^>]+>', ' ', content).strip()
    if len(clean) > 500:
        print(f"Attr: [{attr}] -> Content len: {len(clean)}")
        print("Sample:", clean[:300])
        print("="*40)
