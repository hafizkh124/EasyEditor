# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — commit `f809d69`.** Edge functions changed: `islamic-search`
(plus the shared files it imports). **No migrations.**

---

```
The GitHub repo's `main` branch has been updated (latest commit f809d69).
Please sync and redeploy these Supabase Edge Functions:

  - islamic-search
  - refine-text
  - resource-search

(refine-text and resource-search import _shared/citationEngine.ts, which gained
an optional parameter; their behaviour is unchanged, but they bundle the file.)

## What to do

1. Pull the latest `main`.
2. Redeploy the three functions above.
3. Do NOT create, run, or generate any database migration. This change set
   contains zero schema changes.
4. Do NOT refactor the exported `handle(req)` pattern back into an inline
   `Deno.serve(async (req) => { ... })`. It is exported on purpose so tests can
   call it.

## What changed

- `islamic-search/index.ts`: (a) the personal-library tier now uses a stricter
  similarity threshold and caps at 3 rows; (b) each source's passage text
  (<=1200 chars) is added to the `sources_ready` event; (c) the live-scrape tier
  (domain-scrape) is optional and only gets 1.5s after the other tiers finish.
- `_shared/citationEngine.ts`: personalVectorChannel / personalLexicalChannel
  accept an optional options argument (defaults = old behaviour).
- `_shared/fanOutGrace.ts`: new helper file.
```

---

## Notes for you (not for Lovable)

After it is deployed, tell Claude and it will re-run the 23 sample questions
to compare against the 2026-10-13 baseline (docs/PHASE0-DIAGNOSIS-URDU.md).
