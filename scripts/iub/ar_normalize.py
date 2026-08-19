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
