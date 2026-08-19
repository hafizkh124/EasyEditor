import urllib.request, ssl, re, sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {'User-Agent': 'EasyEditor-ScholarResearch/1.0'}

# 1. Narrators Index
url_narr = 'https://islamicurdubooks.com/hadith/hadith_narrators.php'
req = urllib.request.Request(url_narr, headers=HEADERS)
with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
    html_narr = resp.read().decode('utf-8', errors='ignore')

links = re.findall(r'href=[\'"]([^\'"]+)[\'"]', html_narr)
narr_links = [l for l in links if 'rawy' in l or 'narrator' in l or 'detail' in l]
print(f"Total links on Narrators index: {len(links)}")
print("Sample narrator links:", narr_links[:10])

# 2. Quran Index
url_quran = 'https://islamicurdubooks.com/quran/index.php'
req_q = urllib.request.Request(url_quran, headers=HEADERS)
with urllib.request.urlopen(req_q, context=ctx, timeout=20) as resp:
    html_q = resp.read().decode('utf-8', errors='ignore')

q_links = re.findall(r'href=[\'"]([^\'"]+)[\'"]', html_q)
print(f"\nTotal links on Quran index: {len(q_links)}")
print("Sample Quran links:", [l for l in q_links if 'surahid' in l or 'tafs' in l or 'word' in l][:10])

# 3. Istalahat Index
url_ist = 'https://islamicurdubooks.com/istalahat_hadith.php'
req_i = urllib.request.Request(url_ist, headers=HEADERS)
with urllib.request.urlopen(req_i, context=ctx, timeout=20) as resp:
    html_i = resp.read().decode('utf-8', errors='ignore')

i_links = re.findall(r'href=[\'"]([^\'"]+bsc_id=[^\'"]+)[\'"]', html_i)
print(f"\nIstalahat links (bsc_id): {len(i_links)}")
print("Sample Istalahat links:", i_links[:5])

# 4. Dua Index
url_dua = 'https://islamicurdubooks.com/dua/index.php'
req_d = urllib.request.Request(url_dua, headers=HEADERS)
with urllib.request.urlopen(req_d, context=ctx, timeout=20) as resp:
    html_d = resp.read().decode('utf-8', errors='ignore')

d_links = re.findall(r'href=[\'"]([^\'"]+)[\'"]', html_d)
print(f"\nDua links: {len(d_links)}")
print("Sample Dua links:", [l for l in d_links if 'dua' in l or 'id=' in l][:10])
