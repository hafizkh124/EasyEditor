"""
scrape_lexicon.py - Part 3.4: Quran root-word concordance + word thesaurus.
Outputs canonical CSV to data/iub/lexicon.csv.

Two distinct entities live behind two different pages (see data/iub_lexicon_urls.json,
produced by discover_lexicon.py):

  roots  quran_root_words_sel.php?froot_words={root}
         A concordance: every Quranic occurrence of a root, one table row each
         (word form, verse excerpt with the word highlighted, Urdu translation,
         a bracketed [surah-name:ayah] reference). Emitted as ONE ROW PER
         OCCURRENCE, not one giant per-root document -- a root like "ق و ل"
         appears dozens of times across the Quran, and a single document
         mixing all of them would be worse for embedding/retrieval precision
         than one focused verse-level entry per occurrence. The bracketed
         reference gives an exact (surah, ayah) pair directly, no separate
         mapping table needed (unlike tafsir's faayat_id).

  words  mutradif_word_detail.php?fmutradif_words_id={id}
         A thesaurus entry: one Arabic word + its Urdu meaning + Arabic
         synonyms. This IS one cohesive document per page -- no natural
         sub-splitting the way the root concordance has.

NOTE on root separators: the site encodes a root's letters joined by '-' on
quran_root_words.php but by '+' on quran_word_list.php for what turned out to
be the SAME roots -- discover_lexicon.py's raw harvest had 2,177 "roots"
before this was caught; deduplicating on a normalized form left 1,662 true
unique roots. Use the string exactly as stored in iub_lexicon_urls.json
(already deduplicated) -- do not reconstruct or guess a separator.
"""

import os
import re
import sys
import csv
import json
import urllib.parse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
from scripts.iub.client import fetch_page
from scripts.iub.scrape_hadith import clean_html, CSV_HEADERS

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

OUT_FILE = os.path.join("data", "iub", "lexicon.csv")
os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)

BASE = "https://islamicurdubooks.com/quran"


def _class_match(html, class_name):
    """Match a div's content by class name, tolerating both quote styles (see
    the same helper pattern in scrape_hadith.py / scrape_misc.py).

    NON-GREEDY UP TO THE FIRST </div> -- correct only when the target div has
    no nested <div> children. Use _class_match_balanced for containers
    (bab_container, urd_container) that wrap further divs, or this silently
    truncates at the first inner close tag instead of the real one."""
    m = re.search(
        r'class=["\']' + r'[^"\']*' + re.escape(class_name) + r'[^"\']*["\'][^>]*>(.*?)</div>',
        html, re.DOTALL,
    )
    return m.group(1) if m else None


def _class_match_balanced(html, class_name):
    """Like _class_match, but tracks <div>/</div> depth so a container that
    itself holds nested divs (bab_container, urd_container) returns its FULL
    content instead of truncating at the first inner </div>. Found the hard
    way: word-thesaurus pages nest the explanation paragraph and the synonym
    list several divs deep inside these containers."""
    m = re.search(
        r'class=["\']' + r'[^"\']*' + re.escape(class_name) + r'[^"\']*["\']',
        html,
    )
    if not m:
        return None
    tag_end = html.find(">", m.end())
    if tag_end == -1:
        return None
    pos = tag_end + 1
    depth = 1
    for tok in re.finditer(r'<div\b|</div>', html[pos:]):
        if tok.group(0) == "</div>":
            depth -= 1
            if depth == 0:
                return html[pos:pos + tok.start()]
        else:
            depth += 1
    return None


REF_RE = re.compile(r'\[(\d+)-([^:\]]+):(\d+)\]')


def _root_slug(root):
    # 'root-with-hyphen' / 'root+with+plus' -> a stable ASCII-safe key for passage_key
    letters = re.split(r'[-+]', root)
    return "".join(letters)


def parse_root_page(root):
    enc = urllib.parse.quote(root)
    url = f"{BASE}/quran_root_words_sel.php?froot_words={enc}"
    html, is_missing, _ = fetch_page(url, "lexicon", f"root_{_root_slug(root)}")
    if not html or is_missing:
        return []
    if "کوئی قرآنی مادہ نہیں ملا" in html:
        return []

    root_display_m = re.search(r"class='fontarabic fs4 red'>(.*?)</span>", html)
    root_display = clean_html(root_display_m.group(1)) if root_display_m else root

    rows_out = []
    # Split into table rows; each <tr> holds one occurrence.
    for tr in re.findall(r'<tr>(.*?)</tr>', html, re.DOTALL):
        word_m = re.search(
            r'class="fontarabic fs2 lhp8 center txtlstarb babblue">(.*?)</div>', tr, re.DOTALL)
        if not word_m:
            continue
        word_form = clean_html(word_m.group(1))

        # The verse cell carries BOTH the Arabic ayah text and, nested inside
        # it, the [surah-name:ayah] reference span -- pull the reference out
        # first, then clean the remainder as the verse text.
        ref_m = REF_RE.search(tr)
        if not ref_m:
            continue
        surah_num, surah_name, ayah = ref_m.group(1), ref_m.group(2), ref_m.group(3)

        verse_m = re.search(r'class="fontarabic fs2 lhp8 right">(.*?)</div>', tr, re.DOTALL)
        verse_ar = clean_html(verse_m.group(1)) if verse_m else ""
        verse_ar = REF_RE.sub("", verse_ar).strip()

        urdu_m = re.search(r'class="fonturdu fs2 lhp8 right">(.*?)</div>', tr, re.DOTALL)
        urdu = clean_html(urdu_m.group(1)) if urdu_m else ""
        # Strip a trailing "[لفظ بہ لفظ ترجمہ]" link label if present.
        urdu = re.sub(r'\[?لفظ بہ لفظ ترجمہ\]?\s*$', '', urdu).strip()

        if not verse_ar or not urdu:
            continue

        citation_ref = {
            "discipline": "lughat",
            "root": root_display,
            "word_form": word_form,
            "surah_number": int(surah_num),
            "surah_name": surah_name,
            "verse": int(ayah),
            "source": "islamicurdubooks.com",
            "url": url,
        }

        rows_out.append({
            "domain": "islamicurdubooks-lexicon",
            "source_type": "lexicon",
            "title": f"لغت: {root_display} — {surah_name} {ayah}",
            "content": (
                f"روٹ: {root_display}   لفظ: {word_form}\n\n"
                f"عربی: {verse_ar}\n\nاردو ترجمہ: {urdu}"
            ),
            "content_ar": verse_ar,
            "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
            "language": "ur",
            "source_url": url,
            "passage_key": f"lexicon:iub:root:{_root_slug(root)}:{surah_num}:{ayah}",
        })

    return rows_out


def parse_word_page(word_id):
    url = f"{BASE}/mutradif_word_detail.php?fmutradif_words_id={word_id}"
    html, is_missing, _ = fetch_page(url, "lexicon", f"word_{word_id}")
    if not html or is_missing:
        return None

    arabic_word_m = re.search(
        r"class='fontarabic fs2 lhp8 center blue'>(.*?)</div>", html, re.DOTALL)
    arabic_word = clean_html(arabic_word_m.group(1)) if arabic_word_m else ""

    # The word's own explanation sits in the same bab_container, right after
    # the arabic_word span, as a 'fonturdu fs2 center' div -- bab_container
    # nests both, so it needs the balanced (depth-tracking) extractor, not
    # the plain first-</div> one.
    bab = _class_match_balanced(html, "bab_container")
    explanation = ""
    if bab:
        exp_m = re.search(r"class='fonturdu fs2 center'>(.*?)</div>", bab, re.DOTALL)
        explanation = clean_html(exp_m.group(1)) if exp_m else ""

    # Related Urdu glosses + Arabic synonyms block -- also nested, same reason.
    urd_container = _class_match_balanced(html, "urd_container")
    synonyms_text = clean_html(urd_container) if urd_container else ""

    if not arabic_word or (not explanation and not synonyms_text):
        return None

    citation_ref = {
        "discipline": "lughat",
        "word_id": word_id,
        "arabic_word": arabic_word,
        "source": "islamicurdubooks.com",
        "url": url,
    }

    content_parts = [f"لغت: {arabic_word}"]
    if explanation:
        content_parts.append(explanation)
    if synonyms_text:
        content_parts.append(synonyms_text)

    return {
        "domain": "islamicurdubooks-lexicon",
        "source_type": "lexicon",
        "title": f"لغت: {arabic_word}",
        "content": "\n\n".join(content_parts),
        "content_ar": arabic_word,
        "citation_ref": json.dumps(citation_ref, ensure_ascii=False),
        "language": "ur",
        "source_url": url,
        "passage_key": f"lexicon:iub:word:{word_id}",
    }


def main():
    data = json.load(open("data/iub_lexicon_urls.json", encoding="utf-8"))
    roots = data["roots"]
    word_ids = data["word_ids"]
    print(f"=== Scraping {len(roots):,} roots + {len(word_ids):,} words ===", flush=True)

    rows = []
    empty_roots = 0
    for i, root in enumerate(roots, 1):
        r = parse_root_page(root)
        if not r:
            empty_roots += 1
        rows.extend(r)
        if i % 100 == 0:
            print(f"   roots: {i:,}/{len(roots):,}  rows so far: {len(rows):,}", flush=True)

    root_rows = len(rows)
    for i, wid in enumerate(word_ids, 1):
        r = parse_word_page(wid)
        if r:
            rows.append(r)
        if i % 100 == 0:
            print(f"   words: {i:,}/{len(word_ids):,}  total rows: {len(rows):,}", flush=True)

    print(f"\nRoots yielded {root_rows:,} occurrence-rows ({empty_roots} roots with no usable rows)")
    print(f"Words yielded {len(rows) - root_rows:,} rows")
    print(f"Total: {len(rows):,} rows", flush=True)

    with open(OUT_FILE, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_HEADERS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"✅ Saved {len(rows):,} rows to {OUT_FILE}", flush=True)


if __name__ == "__main__":
    main()
