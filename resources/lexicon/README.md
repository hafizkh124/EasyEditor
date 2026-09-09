# Printed-dictionary page index (`lookup_lexicon`, ADR-0043)

`root-page-map.json` lets `lookup_lexicon` emit a citable
`[مصباح اللغات، ص N]` / `[القاموس الوحيد، ص N]` reference. It ships **empty**.

## Why empty

*Miṣbāḥ al-Lughāt* (Balyāwī) and *al-Qāmūs al-Wāḥid* exist online only as scanned
PDFs — no structured full text, and no root→page index of those editions. We do
**not** let the agent synthesise a gloss and stamp a page citation on it: that is
a fabricated reference, and the citation ledger exists to prevent exactly that.

Until a real index is supplied, `lookup_lexicon` works from the corpus's verified
Arabic→Urdu material (لغتِ قرآن, `islamicurdubooks-lexicon`) and gives an
al-Maany deep link the scholar opens to verify.

## Format

```json
{
  "roots": [
    { "root": "سربل", "headword": "سرابيل", "misbah_page": 345, "qamus_page": 812 }
  ]
}
```

`headword` (or `root`) is matched after ḥarakāt-stripping and hamza/yāʾ
normalisation. Drop a populated file here and rebuild — no code change.
