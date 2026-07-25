#!/usr/bin/env python3
"""
urdufatwa_scraper.py - Resilient, Incremental Scraper for urdufatwa.com.

Features:
- Caches sitemap locally to data/sitemap.xml to avoid repeated 5MB network downloads.
- Maintains data/scraping_state.json cache so previously scraped URLs are skipped instantly.
- Saves extracted fatwas incrementally to data/urdufatwa_normalized.csv.
- Fast multi-threaded processing with automatic retries and rate limits.
"""

import os
import sys
import re
import csv
import json
import time
import ssl
import urllib.request
import urllib.parse
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed

# Reconfigure stdout for UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Set global socket default timeout
socket.setdefaulttimeout(15)

# SSL context setup
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ur,en-US;q=0.9,en;q=0.8',
}

SITEMAP_LOCAL = os.path.join("data", "sitemap.xml")
STATE_FILE = os.path.join("data", "scraping_state.json")
CSV_OUTPUT = os.path.join("data", "urdufatwa_normalized.csv")

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Could not read state file: {e}")
    return {"processed_urls": {}, "last_run": None, "total_scraped": 0}

def save_state(state):
    os.makedirs("data", exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)

def fetch_url(url, retries=2, timeout=12):
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers=HEADERS)
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
                return resp.read().decode('utf-8', errors='ignore')
        except Exception as e:
            if attempt < retries:
                time.sleep(1)
            else:
                return None

def get_sitemap_urls():
    os.makedirs("data", exist_ok=True)
    content = ""
    if os.path.exists(SITEMAP_LOCAL) and os.path.getsize(SITEMAP_LOCAL) > 100_000:
        print(f"Loading sitemap from local cache ({SITEMAP_LOCAL})...")
        with open(SITEMAP_LOCAL, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
    else:
        print("Downloading sitemap.xml from urdufatwa.com...")
        content = fetch_url("https://urdufatwa.com/sitemap.xml", retries=3, timeout=45)
        if content and len(content) > 100_000:
            with open(SITEMAP_LOCAL, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Saved sitemap to local cache ({len(content):,} bytes).")
    
    urls = []
    if content:
        urls = re.findall(r'<loc>(https?://urdufatwa\.com/[^<]+)</loc>', content)
        print(f"Extracted {len(urls):,} URLs from sitemap.")
    
    # Filter valid content URLs
    fatwa_urls = []
    seen = set()
    for u in urls:
        u_clean = u.strip()
        if u_clean in seen:
            continue
        if any(ext in u_clean.lower() for ext in ['.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webmanifest', '.pdf']):
            continue
        if any(ignore in u_clean.lower() for ignore in ['/about-us', '/contact', '/privacy', '/login', '/register', '/assets']):
            continue
        seen.add(u_clean)
        fatwa_urls.append(u_clean)
    
    return fatwa_urls

def parse_fatwa_page(url, html):
    if not html:
        return None
    
    clean_html = re.sub(r'<script.*?>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    clean_html = re.sub(r'<style.*?>.*?</style>', '', clean_html, flags=re.DOTALL | re.IGNORECASE)
    
    title = ""
    t_match = re.search(r'<h1[^>]*>(.*?)</h1>', clean_html, re.DOTALL | re.IGNORECASE)
    if t_match:
        title = t_match.group(1)
    else:
        og_match = re.search(r'<meta\s+property=["\']og:title["\']\s+content=["\'](.*?)["\']', clean_html, re.IGNORECASE)
        if og_match:
            title = og_match.group(1)
        else:
            title_match = re.search(r'<title[^>]*>(.*?)</title>', clean_html, re.DOTALL | re.IGNORECASE)
            if title_match:
                title = title_match.group(1)
    
    title = re.sub(r'<[^>]+>', '', title).strip()
    title = re.sub(r'\s+', ' ', title)
    
    fatwa_id = ""
    id_match = re.search(r'/(\d+)(?:[/?#]|$)', url)
    if id_match:
        fatwa_id = id_match.group(1)
    else:
        fatwa_id = url.rstrip('/').split('/')[-1]
    
    scholar = ""
    scholar_match = re.search(r'(?:مفتی|الشیخ|فضیلة الشيخ|الشيخ|مفتي)\s*:?\s*([^<&\n]+)', clean_html)
    if scholar_match:
        scholar = scholar_match.group(0).strip()
    
    category = ""
    cat_match = re.search(r'<a[^>]+href=["\']https?://urdufatwa\.com/category/\d+["\'][^>]*>(.*?)</a>', clean_html, re.IGNORECASE)
    if cat_match:
        category = re.sub(r'<[^>]+>', '', cat_match.group(1)).strip()
    
    content_text = ""
    article_match = re.search(r'<article[^>]*>(.*?)</article>', clean_html, re.DOTALL | re.IGNORECASE)
    if article_match:
        content_text = article_match.group(1)
    else:
        paras = re.findall(r'<p[^>]*>(.*?)</p>', clean_html, re.DOTALL | re.IGNORECASE)
        if paras:
            content_text = "\n\n".join(paras)
        else:
            content_text = clean_html
    
    content_text = re.sub(r'<[^>]+>', ' ', content_text)
    content_text = re.sub(r'&nbsp;', ' ', content_text)
    content_text = re.sub(r'&quot;', '"', content_text)
    content_text = re.sub(r'&amp;', '&', content_text)
    content_text = re.sub(r'\s+', ' ', content_text).strip()
    
    if not title or len(content_text) < 30:
        return None
    
    return {
        "url": url,
        "fatwa_id": fatwa_id,
        "title": title[:300],
        "scholar": scholar[:150],
        "category": category[:150],
        "content": content_text[:10000],
    }

def main():
    print("=== Incremental UrduFatwa Scraper Engine ===")
    state = load_state()
    scraped_urls = state.get("processed_urls", {})
    print(f"Loaded state: {len(scraped_urls):,} URLs already in cache.")
    
    urls = get_sitemap_urls()
    if not urls:
        print("No URLs found to process.")
        return
    
    pending_urls = [u for u in urls if u not in scraped_urls]
    print(f"Total discovered: {len(urls):,} | Already scraped: {len(scraped_urls):,} | New pending to scrape: {len(pending_urls):,}")
    
    if not pending_urls:
        print("Everything is up to date! 0 new fatwas to scrape.")
        return
    
    file_exists = os.path.exists(CSV_OUTPUT)
    csv_file = open(CSV_OUTPUT, "a", encoding="utf-8", newline="")
    fieldnames = ["url", "fatwa_id", "title", "scholar", "category", "content"]
    writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
    if not file_exists:
        writer.writeheader()
    
    scraped_count = 0
    start_time = time.time()
    
    def process_one(target_url):
        html = fetch_url(target_url, retries=1)
        if not html:
            return None
        rec = parse_fatwa_page(target_url, html)
        return rec
    
    max_workers = 12
    print(f"\nStarting parallel extraction with {max_workers} worker threads...")
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_one, u): u for u in pending_urls}
        for future in as_completed(futures):
            target_url = futures[future]
            try:
                rec = future.result()
                if rec:
                    writer.writerow(rec)
                    csv_file.flush()
                    scraped_urls[target_url] = int(time.time())
                    scraped_count += 1
                else:
                    scraped_urls[target_url] = int(time.time())
            except Exception as e:
                scraped_urls[target_url] = int(time.time())
            
            if scraped_count > 0 and scraped_count % 50 == 0:
                state["processed_urls"] = scraped_urls
                state["last_run"] = int(time.time())
                state["total_scraped"] = len(scraped_urls)
                save_state(state)
                elapsed = time.time() - start_time
                rate = scraped_count / elapsed if elapsed > 0 else 0
                print(f"Progress: {scraped_count:,} / {len(pending_urls):,} new fatwas scraped ({rate:.1f} fatwas/sec)...")
    
    csv_file.close()
    state["processed_urls"] = scraped_urls
    state["last_run"] = int(time.time())
    state["total_scraped"] = len(scraped_urls)
    save_state(state)
    
    elapsed = time.time() - start_time
    print(f"\n=== Scraping Completed! ===")
    print(f"New Fatwas Scraped: {scraped_count:,} in {elapsed:.1f} seconds")
    print(f"Total Cache Size: {len(scraped_urls):,} URLs")
    print(f"CSV saved at: {CSV_OUTPUT}")

if __name__ == "__main__":
    main()
