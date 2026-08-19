import gzip, re, sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

with gzip.open('data/iub_cache/rijal_index/letter_ب.html.gz', 'rt', encoding='utf-8') as f:
    html = f.read()

links = re.findall(r'href=[\'"]([^\'"]+)[\'"]', html)
p_links = [l for l in links if 'hadith_narrators.php' in l]
print(f"Total hadith_narrators links: {len(p_links)}")
for l in p_links[:15]:
    print("  ", l)
