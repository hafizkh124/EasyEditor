import re
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

filepath = r"C:\Users\hafiz\.gemini\antigravity\brain\edab470b-3058-41fd-a04c-be07f05beb68\.system_generated\steps\206\content.md"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Find rows in table
rows = re.findall(r'<tr>\s*<td class="tdhd"><div[^>]*>(\d+)</div></td>\s*<td class="tddet">.*?<a href="([^"]+)"[^>]*>([^<]+)</a>.*?احادیث:\s*\[(\d+)\]', content, re.DOTALL)

print(f"Total matched books in table: {len(rows)}")
for num, url, title, count in rows:
    print(f"{num.strip()}. {title.strip()} | URL: {url.strip()} | Count: {count.strip()}")
