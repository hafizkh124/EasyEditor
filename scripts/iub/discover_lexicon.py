"""
discover_lexicon.py - Part 3.4 discovery pass for the Quran lexicon modules.

The site publishes no total anywhere for these, so the plan's "~2,000" was an
explicit placeholder. This walks the indexes and writes the real inventory to
data/iub_lexicon_urls.json; only then is it worth scraping.

Two distinct entities live behind the two index pages:

  roots  quran_root_words.php  -> quran_root_words_sel.php?froot_words={root}
                                  keyed by the root itself, e.g. 'أ-ب-و'
  words  quran_word_list.php   -> mutradif_word_detail.php?fmutradif_words_id={id}
                                  keyed by a small integer id

Two things learned the hard way and encoded here:

  1. LETTERS COME FROM THE PAGE. The filter set uses 'أ', not bare 'ا' --
     quran_root_words.php?q=ا returns nothing while ?q=م returns rows. A
     hardcoded alphabet (which is what limited scrape_rijal.py) would silently
     miss whole letters, so the letters are parsed out of each index page's own
     ?q= links and unioned with a fallback list.

  2. PAGINATION IS ASSUMED UNTIL DISPROVEN. No page= links appear on any lexicon
     page sampled so far, but the narrator index looked the same until a letter
     crossed 100 rows -- and its paginator is windowed, so page 1 never
     advertises the last page. The only safe stop condition is a page that adds
     nothing new, which is what the walk below uses. If the site never
     paginates these, the extra probe costs one request per letter.

Run:  python -m scripts.iub.discover_lexicon
"""

import os
import re
import sys
import json
import urllib.parse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.client import fetch_page

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT_FILE = os.path.join("data", "iub_lexicon_urls.json")
BASE = "https://islamicurdubooks.com/quran"

INDEXES = {
    "roots": "quran_root_words.php",
    "words": "quran_word_list.php",
}

# Only a fallback -- the real set is read off each page. Includes both 'أ' and
# 'ا' because the two indexes do not agree on which they use.
FALLBACK_LETTERS = list("أابتثجحخدذرزسشصضطظعغفقكلمنهوي")

RE_ROOT = re.compile(r"quran_root_words_sel\.php\?froot_words=([^'\"&<>]+)")
RE_WORD = re.compile(r"mutradif_word_detail\.php\?fmutradif_words_id=(\d+)")
RE_QLINK = re.compile(r"href=['\"]\?q=([^'\"&]+)")
RE_PAGE = re.compile(r"href=['\"][^'\"]*[?&]page=(\d+)")


def harvest(html):
    """Pull every root key and word id out of one page."""
    roots = {urllib.parse.unquote(m) for m in RE_ROOT.findall(html)}
    words = {int(m) for m in RE_WORD.findall(html)}
    return roots, words


def letters_on(html):
    return {urllib.parse.unquote(m) for m in RE_QLINK.findall(html)}


def walk(kind, script, max_pages=40):
    roots, words = set(), set()

    # Page 0: no filter. Also the source of the letter list.
    html, _, err = fetch_page(f"{BASE}/{script}", "lex_index", f"{kind}_all")
    if not html:
        print(f"  {kind}: index fetch failed ({err})", flush=True)
        return roots, words
    r, w = harvest(html)
    roots |= r
    words |= w
    letters = letters_on(html) or set(FALLBACK_LETTERS)
    letters |= set(FALLBACK_LETTERS)
    print(f"  {kind}: unfiltered index -> {len(r)} roots, {len(w)} words; "
          f"{len(letters)} letters to walk", flush=True)

    for letter in sorted(letters):
        q = urllib.parse.quote(letter)
        page = 1
        letter_r, letter_w = set(), set()
        while page <= max_pages:
            suffix = "" if page == 1 else f"&page={page}"
            url = f"{BASE}/{script}?q={q}{suffix}"
            html, _, err = fetch_page(url, "lex_index", f"{kind}_{letter}_p{page}")
            if not html:
                break
            r, w = harvest(html)
            # Stop when a page contributes nothing new: covers both "no such
            # page" and "paginator loops back to page 1".
            if not (r - letter_r) and not (w - letter_w):
                break
            letter_r |= r
            letter_w |= w
            if page == 1 and not RE_PAGE.search(html):
                break  # this index genuinely does not paginate
            page += 1

        if page > max_pages:
            print(f"     WARNING '{letter}' hit the {max_pages}-page cap", flush=True)
        roots |= letter_r
        words |= letter_w
        print(f"     q={letter}: {len(letter_r)} roots, {len(letter_w)} words "
              f"(running total {len(roots)}/{len(words)})", flush=True)

    return roots, words


def main():
    all_roots, all_words = set(), set()
    for kind, script in INDEXES.items():
        print(f"\n=== {kind} ({script}) ===", flush=True)
        r, w = walk(kind, script)
        all_roots |= r
        all_words |= w

    payload = {
        "roots": sorted(all_roots),
        "word_ids": sorted(all_words),
        "counts": {
            "roots": len(all_roots),
            "words": len(all_words),
            "total": len(all_roots) + len(all_words),
        },
        "url_templates": {
            "root": f"{BASE}/quran_root_words_sel.php?froot_words={{root}}",
            "word": f"{BASE}/mutradif_word_detail.php?fmutradif_words_id={{id}}",
        },
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"\n=== inventory ===")
    print(f"  roots : {len(all_roots):,}")
    print(f"  words : {len(all_words):,}")
    print(f"  TOTAL : {len(all_roots) + len(all_words):,}  (plan placeholder was ~2,000)")
    print(f"  written to {OUT_FILE}")


if __name__ == "__main__":
    main()
