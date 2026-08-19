import urllib.request, ssl, re, sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {'User-Agent': 'EasyEditor-ScholarResearch/1.0'}

# 1. Tafseer
url = "https://islamicurdubooks.com/quran/tafseer_ibn_kaseer.php?faayat_id=1"
req = urllib.request.Request(url, headers=HEADERS)
with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

print("=== Tafseer HTML length:", len(html))
# Find paragraphs or main containers
ps = re.findall(r'<p[^>]*>(.*?)</p>', html, re.DOTALL)
print("Paragraphs found:", len(ps))
for i, p in enumerate(ps[:3]):
    clean = re.sub(r'<[^>]+>', ' ', p).strip()
    print(f"P {i+1}: {clean[:200]}...")

# 2. Word by word
url_wbw = "https://islamicurdubooks.com/quran/quran_word_by_word.php?faayat_id=1"
req_w = urllib.request.Request(url_wbw, headers=HEADERS)
with urllib.request.urlopen(req_w, context=ctx, timeout=20) as resp:
    html_w = resp.read().decode('utf-8', errors='ignore')

print("\n=== WBW HTML length:", len(html_w))
tables = re.findall(r'<table[^>]*>(.*?)</table>', html_w, re.DOTALL)
print("WBW tables found:", len(tables))
for i, t in enumerate(tables[:2]):
    clean = re.sub(r'<[^>]+>', ' ', t).strip()
    print(f"WBW Table {i+1}: {clean[:200]}...")
