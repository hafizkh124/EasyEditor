#!/usr/bin/env python3
"""
tohed_hadith_scraper.py - Scrapes 14 Hadith collections from tohed.com/hadith/
and exports them into canonical scholarly_documents CSV format.

Captures:
  - Arabic Matn
  - Urdu Translation
  - Chapter / Bab titles
  - Footnotes, Notes & Sharh (تعلیقات و حواشی)
  - Takhreej & Grading (حکم / تخریج)
  - Reference Sources
"""

import os
import sys
import re
import csv
import json
import time
import argparse
import urllib.request
import urllib.error
from html.parser import HTMLParser
from concurrent.futures import ThreadPoolExecutor, as_completed

# Reconfigure stdout to utf-8 for Windows console support
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

csv.field_size_limit(2147483647)

TARGET_BOOKS = {
    "ibn-khuzaimah":            {"title": "صحيح ابن خزيمه",              "total": 3432},
    "sahih-ibn-hibban":         {"title": "صحيح ابن حبان",               "total": 7491},
    "musannaf-ibn-abi-shaybah": {"title": "مصنف ابن ابي شيبه",           "total": 38919},
    "darqutni":                 {"title": "سنن الدارقطني",               "total": 4858},
    "silsilah-sahihah":          {"title": "سلسله احاديث صحيحه",          "total": 4495},
    "mishkat-al-masabih":       {"title": "مشكوة المصابيح",              "total": 6288},
    "muntaqa-ibn-al-jarud":     {"title": "المنتقى ابن الجارود",         "total": 1110},
    "sunan-saeed-bin-mansur":   {"title": "سنن سعید بن منصور",           "total": 4167},
    "lulu-wal-marjan":          {"title": "اللؤلؤ والمرجان",             "total": 1889},
    "sahih-adab-al-mufrad":     {"title": "صحيح الادب المفرد",           "total": 590},
    "sahifa-hammam":            {"title": "صحيفه همام بن منبه",          "total": 139},
    "musnad-shafii":            {"title": "مسند الإمام الشافعي",         "total": 1819},
    "musnad-humaydi":           {"title": "مسند الحميدي",                "total": 1345},
    "musnad-ishaq":             {"title": "مسند اسحاق بن راهويه",        "total": 2437},
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ur,ar,en-US,en;q=0.9",
}

def clean_html_text(raw_html):
    if not raw_html:
        return ""
    text = re.sub(r'<br\s*/?>', '\n', raw_html, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n\s*\n+', '\n', text)
    return text.strip()

def fetch_hadith(slug, num, retries=3):
    url = f"https://tohed.com/hadith/{slug}/{num}/"
    req = urllib.request.Request(url, headers=HEADERS)
    
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                html = resp.read().decode("utf-8", "ignore")
                
                # 1. Parse JSON-LD structured data if available
                article_body = ""
                headline = ""
                chapter = ""
                
                json_ld_matches = re.findall(r'<script type="application/ld\+json">(.*?)</script>', html, re.DOTALL)
                for jstr in json_ld_matches:
                    try:
                        jdata = json.loads(jstr)
                        if jdata.get("@type") == "Article":
                            article_body = jdata.get("articleBody", "")
                            headline = jdata.get("headline", "")
                            chapter = jdata.get("alternativeHeadline", "")
                    except Exception:
                        pass
                
                # 2. Extract Hadith elements via Regex / Selectors
                # Arabic Matn
                ar_matches = re.findall(r'<div class="had-ar[^"]*">(.*?)</div>', html, re.DOTALL)
                ar_text_str = "\n".join([clean_html_text(m) for m in ar_matches if clean_html_text(m)]).strip()
                
                # Urdu text (translation + notes/sharh)
                ur_matches = re.findall(r'<div class="had-ur">(.*?)</div>', html, re.DOTALL)
                ur_blocks = [clean_html_text(m) for m in ur_matches if clean_html_text(m)]
                
                # Separating main Urdu translation from scholar notes/commentary/footnotes
                main_ur_translation = ""
                scholar_notes_list = []
                
                for b in ur_blocks:
                    if any(kw in b for kw in ["اردو حاشیہ", "فوائد و مسائل", "فقہ الحدیث", "تخریج الحدیث", "شرح", "توضیح"]):
                        scholar_notes_list.append(b)
                    else:
                        if not main_ur_translation:
                            main_ur_translation = b
                        else:
                            scholar_notes_list.append(b)
                            
                if not main_ur_translation and article_body:
                    main_ur_translation = article_body
                    
                scholar_str = "\n\n".join(scholar_notes_list).strip()
                
                # Ref lines
                ref_matches = re.findall(r'<div class="had-refline">(.*?)</div>', html, re.DOTALL)
                ref_str = "\n".join([clean_html_text(m) for m in ref_matches if clean_html_text(m)]).strip()
                
                if not ar_text_str and not main_ur_translation:
                    return None
                    
                # Full merged content for vector search & retrieval
                content_components = []
                if chapter:
                    content_components.append(f"موضوع/باب: {chapter}")
                if ar_text_str:
                    content_components.append(f"المتن العربي:\n{ar_text_str}")
                if main_ur_translation:
                    content_components.append(f"الترجمة اردو:\n{main_ur_translation}")
                if scholar_str:
                    content_components.append(f"التعليقات والفوائد والشرح:\n{scholar_str}")
                if ref_str:
                    content_components.append(f"التخريج والمصدر:\n{ref_str}")
                    
                full_content = "\n\n".join(content_components)
                
                book_meta = TARGET_BOOKS.get(slug, {})
                book_title = book_meta.get("title", slug)
                
                citation_ref = {
                    "collection": slug,
                    "book": book_title,
                    "hadith_number": num,
                    "chapter": chapter,
                    "scholar_notes": scholar_str,
                    "takhreej": ref_str,
                    "source": "tohed.com"
                }
                
                return {
                    "domain": "tohed-hadith",
                    "source_type": "hadith",
                    "title": f"{book_title} - حدیث {num}",
                    "content": full_content,
                    "content_ar": ar_text_str if ar_text_str else None,
                    "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
                    "language": "ur",
                    "source_url": url,
                    "passage_key": f"hadith:tohed:{slug}:{num}"
                }
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(1 * (attempt + 1))
        except Exception as e:
            time.sleep(1 * (attempt + 1))
            
    return None

def scrape_book(slug, start_num=1, end_num=None, max_workers=6, output_csv=None):
    if slug not in TARGET_BOOKS:
        print(f"Error: Unknown book slug '{slug}'")
        return
        
    book_meta = TARGET_BOOKS[slug]
    total_hadiths = book_meta["total"]
    if end_num is None:
        end_num = total_hadiths
        
    print(f"Starting scrape for '{slug}' ({book_meta['title']}): Hadiths {start_num} to {end_num}...")
    
    records = []
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(fetch_hadith, slug, n): n for n in range(start_num, end_num + 1)}
        
        for future in as_completed(futures):
            num = futures[future]
            try:
                res = future.result()
                if res:
                    records.append(res)
            except Exception as e:
                pass
                
            if len(records) > 0 and len(records) % 100 == 0:
                print(f"  Progress '{slug}': fetched {len(records)} hadiths...")
                
    records.sort(key=lambda r: json.loads(r["citation_ref"]).get("hadith_number", 0))
    
    if output_csv and records:
        os.makedirs(os.path.dirname(output_csv), exist_ok=True)
        file_exists = os.path.exists(output_csv)
        
        fieldnames = ["domain", "source_type", "title", "content", "content_ar", "citation_ref", "language", "source_url", "passage_key"]
        
        with open(output_csv, "a" if file_exists else "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()
            for r in records:
                writer.writerow(r)
                
    print(f"Completed '{slug}': Extracted {len(records)} hadiths.")
    return records

def main():
    parser = argparse.ArgumentParser(description="Scrape Hadith collections from tohed.com")
    parser.add_argument("--slug", help="Book slug (e.g. ibn-khuzaimah, sahih-ibn-hibban, etc.) or 'all'")
    parser.add_argument("--start", type=int, default=1, help="Start hadith number")
    parser.add_argument("--end", type=int, default=None, help="End hadith number")
    parser.add_argument("--workers", type=int, default=6, help="Number of concurrent worker threads")
    parser.add_argument("--output", default="data/tohed_hadiths.csv", help="Output CSV filepath")
    
    args = parser.parse_args()
    
    if not args.slug:
        print("Please specify --slug (e.g. --slug ibn-khuzaimah or --slug all)")
        print("\nAvailable slugs:")
        for k, v in TARGET_BOOKS.items():
            print(f"  {k:30s} -> {v['title']} ({v['total']} hadiths)")
        return
        
    if args.slug == "all":
        for slug in TARGET_BOOKS:
            scrape_book(slug, start_num=args.start, end_num=args.end, max_workers=args.workers, output_csv=args.output)
    else:
        scrape_book(args.slug, start_num=args.start, end_num=args.end, max_workers=args.workers, output_csv=args.output)

if __name__ == "__main__":
    main()
