"""
ar_normalize.py - Exact Python port of PostgreSQL public.normalize_arabic_text(text).
Mirrors supabase/migrations/20260517000000_smart_arabic_search.sql character-for-character.

Parity is load-bearing: ar_fingerprint is a STORED generated column computed by the
SQL function, and Part 1 matching compares it against fingerprints computed here.
Any divergence makes every match silently fail. See test_ar_normalize.py.
"""

import re
import hashlib

# 1. strip harakat / tashkeel / dagger alef / tatweel.
#    SQL class is [U+064B-U+065F, U+0670, U+0640]: the RANGE ends at U+065F
#    (subscript alef), with the superscript alef U+0670 and the tatweel U+0640
#    listed separately after it. Do NOT 'simplify' this to U+064B-U+0670 -- that
#    wider range swallows U+0660-U+066F, the Arabic-Indic digits, and the port
#    then disagrees with SQL on any text containing a numeral.
#    test_ar_normalize.py parses the real class out of the migration and checks it.
_RE_HARAKAT = re.compile('[ً-ٰٟـ]')

# 2. unify alef variants -> ا
_RE_ALEF = re.compile('[آأإٱ]')

# 3. ta marbuta -> ha
_RE_TA_MARBUTA = re.compile('ة')

# 4. alef maqsura -> ya
_RE_ALEF_MAQSURA = re.compile('ى')

# 5. collapse whitespace. Postgres ARE \s is the ASCII set [ \t\n\r\f\v];
#    Python's \s also matches Unicode spaces such as U+00A0, which scraped HTML
#    is full of. Pin it to the Postgres set so both sides agree.
_RE_WHITESPACE = re.compile('[ \t\n\r\f\v]+')


def normalize_arabic_text(t):
    if not t:
        return ""
    s = _RE_HARAKAT.sub('', t)
    s = _RE_ALEF.sub('ا', s)
    s = _RE_TA_MARBUTA.sub('ه', s)
    s = _RE_ALEF_MAQSURA.sub('ي', s)
    # NOTE: the SQL function does NOT trim -- it only collapses runs. Calling
    # .strip() here dropped the leading/trailing single space SQL leaves behind,
    # changing the md5 for any padded value.
    s = _RE_WHITESPACE.sub(' ', s)
    return s


def ar_fingerprint(t):
    return hashlib.md5(normalize_arabic_text(t).encode('utf-8')).hexdigest()


# ── Fuzzy content matching for Phase E alignment (NOT the DB-parity fingerprint) ──
#
# ar_fingerprint (above) demands byte-for-byte equality after normalization --
# correct for the ar_fingerprint GENERATED COLUMN's own purpose (exact-content
# dedup), wrong for comparing IUB's scrape against hadith-json/tohed-hadith/etc.
# Confirmed live on Sahih Bukhari #1, #10, #50, #100 (2026-08-21): those rows
# are independently digitized from IUB, not derived from it, so isnad
# punctuation drifts unpredictably row to row -- "قال:" here, "قال : " there,
# "قال" with no colon at all elsewhere -- even though the underlying hadith
# text is identical. Exact fingerprint matching returns 0% for a book that
# should align perfectly by every other signal.
#
# This mirrors supabase/functions/_shared/citationEngine.ts's takhrijTokens /
# takhrijHadith, written to solve the exact same problem (cross-collection
# hadith takhrij) for the same reason: word-set overlap tolerant of
# punctuation/whitespace noise, intolerant of genuinely different content.
# Keep the common-word list in sync with TAKHRIJ_COMMON_WORDS there.
_COMMON_WORDS = {
    "قال", "قالت", "قالوا", "رسول", "الله", "النبي", "عليه", "وسلم", "صلي",
    "حدثنا", "حدثني", "اخبرنا", "اخبرني", "سمعت", "روي", "عنه", "عنها",
    "رضي", "بن", "ابن", "ابي", "عبد", "كان", "كانت", "الذي", "التي", "علي",
    "الي", "من", "في", "عن", "انه", "انها", "هذا", "هذه", "ذلك",
}

_RE_TOKEN_SPLIT = re.compile(r'[\s،.:؛()«»"\'\-]+')


def content_tokens(t):
    """Normalized, boilerplate-stripped word set for overlap comparison."""
    norm = normalize_arabic_text(t)
    return {
        w for w in _RE_TOKEN_SPLIT.split(norm)
        if len(w) > 3 and w not in _COMMON_WORDS
    }


def content_overlap_ratio(text_a, text_b):
    """Content-word overlap, normalized by the SMALLER side (so an abridged
    narration still matches its fuller version) -- same formula as
    citationEngine.ts's takhrijHadith. Returns 0.0 if either side has fewer
    than 3 content words (too little to judge rather than a guess)."""
    ta, tb = content_tokens(text_a), content_tokens(text_b)
    if len(ta) < 3 or len(tb) < 3:
        return 0.0
    shared = len(ta & tb)
    return shared / min(len(ta), len(tb))
