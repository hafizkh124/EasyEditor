# P0 spike, proof (4): InPage ↔ RTF round-trip

InPage has no COM interface, no CLI, and no scripting API we could find
(see plan §"کیا ممکن ہے" — "⚠️ کوئی عوامی API نہیں"). This proof is
therefore **entirely manual**. There is nothing to automate here — that
absence is itself the finding that shaped the plan's decision to go
through RTF instead of driving InPage directly.

You need InPage actually installed to run this. If you don't have it,
say so — that in itself is worth knowing before P1 commits engineering
time to the RTF adapter.

## Part A — EasyEditor → InPage (docx/RTF → InPage)

1. Take a `.docx` with: a heading, two paragraphs of Urdu body text, one
   Nastaliq-styled quotation, and at least one real Word footnote (you can
   produce this by hand in Word, or once P1's `word-bridge.ps1` proof (1)
   works, script it).
2. In Word: **File → Save As → Rich Text Format (*.rtf)**.
3. Open InPage → **File → Import → RTF** (menu wording may differ by
   InPage version — note the exact path you used).
4. Record:
   - [ ] Did the Urdu text import at all, or did it come in garbled/blank?
   - [ ] Is the text still in reading order (not reversed/scrambled)?
   - [ ] Did the footnote survive the import in any form, or is it lost?
   - [ ] Did paragraph breaks / headings survive?
   - [ ] Which InPage version did you test (Help → About)?

## Part B — InPage → EasyEditor (InPage → RTF → docx)

1. In InPage, open (or write) a short document with Nastaliq body text.
2. **File → Export → RTF** (or equivalent).
3. Open the resulting `.rtf` in Word.
4. Record:
   - [ ] Does the text render correctly (not garbled/boxes)?
   - [ ] Is it genuinely Unicode text (select it, check Word doesn't show
     it as a picture/embedded object)?
   - [ ] If the source InPage file used the OLD non-Unicode Nooriنستعلیق
     encoding rather than a modern Unicode font, does the export still
     come out readable, or does it need the legacy↔Unicode converter
     mentioned in the plan?

## Pass criteria (see README.md)

Both directions preserve **readable, editable, correctly-ordered Unicode
Urdu text**. Footnotes and headings surviving is a bonus, not required —
note what's lost either way; the plan already commits to being explicit
about lossy conversions (خطرہ #6), it does not require this to be
lossless.

## If this fails

If InPage's RTF import/export turns out to mangle text badly in either
direction, that invalidates the plan's whole InPage strategy — say so
immediately rather than continuing to P1. The fallback options at that
point (UI automation driving InPage's own menus, or dropping InPage
support) are both bigger, separate decisions, not something to improvise
mid-implementation.
