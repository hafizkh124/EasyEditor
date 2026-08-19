"""
Phase A.4 gate: prove ar_normalize.py matches public.normalize_arabic_text().

The expectations are parsed OUT OF THE MIGRATION FILE itself
(supabase/migrations/20260517000000_smart_arabic_search.sql) rather than
retyped here, so this cannot drift from the SQL by transcription error --
which is exactly how the port originally lost U+0660-U+066F.

Run:  python -m pytest scripts/iub/test_ar_normalize.py -q
      (or plain: python scripts/iub/test_ar_normalize.py)
"""
import io
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ar_normalize import normalize_arabic_text  # noqa: E402

MIGRATION = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..",
    "supabase", "migrations", "20260517000000_smart_arabic_search.sql",
)


def _sql_reference():
    """Build a reference implementation from the regexes literally present in
    the SQL, so the test tracks the migration rather than a copy of it."""
    src = io.open(MIGRATION, encoding="utf-8").read()
    body = src[src.index("CREATE OR REPLACE FUNCTION public.normalize_arabic_text"):]
    body = body[:body.index("$$;", body.index("$$"))]
    # the five regexp_replace(<pattern>, <replacement>) pairs, in order
    pairs = re.findall(r"'((?:[^']|'')+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'g'", body)
    assert len(pairs) == 5, f"expected 5 regexp_replace pairs, found {len(pairs)}"

    def run(t):
        s = t or ""
        for pat, rep in pairs:
            flags = 0
            # Postgres ARE \s is the ASCII set; Python's \s is Unicode-aware.
            p = pat.replace(r"\s", "[ \t\n\r\f\v]")
            s = re.sub(p, rep, s, flags=flags)
        return s
    return run


def test_parity_over_arabic_block():
    ref = _sql_reference()
    bad = [hex(c) for c in range(0x0600, 0x0700)
           if normalize_arabic_text(chr(c)) != ref(chr(c))]
    assert not bad, f"port disagrees with SQL on codepoints: {bad}"


def test_parity_on_samples():
    ref = _sql_reference()
    samples = [
        "",
        "قال ٣ رجال",                 # Arabic-Indic digits (the original bug)
        "  الصَّدَقَةُ  ",              # padding: SQL collapses but does NOT trim
        "مُحَمَّدٌ بن",             # NBSP: Postgres \s excludes it, Python's includes it
        "إِنَّ اللّٰهَ ٱلرَّحْمٰنِ",
        "الحمد\tلله\nرب\rالعالمين",
        "عائشة رضى الله عنها",
        "ـــتطويلـــ",
    ]
    for s in samples:
        assert normalize_arabic_text(s) == ref(s), (
            f"mismatch on {s!r}: port={normalize_arabic_text(s)!r} sql={ref(s)!r}"
        )


if __name__ == "__main__":
    test_parity_over_arabic_block()
    test_parity_on_samples()
    print("ar_normalize parity: PASS (Arabic block U+0600-U+06FF + samples)")
