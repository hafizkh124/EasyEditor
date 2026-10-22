# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — latest `main`.** **No migration.** One NEW edge function: `corpus-reads`.

---

```
The GitHub repo's `main` branch has been updated (use the latest commit on main).
Please deploy exactly ONE new edge function. No database migration this round.

  - supabase/functions/corpus-reads/index.ts   (new)
  - supabase/config.toml now has [functions.corpus-reads] verify_jwt = false
    (the function checks the caller's JWT itself, like citation-lookup does)

## Why

The security hardening dropped the "any signed-in user may read" policies on
scholarly_documents, translators, passage_translations and api_response_cache, so the
browser can no longer read them. Three screens did exactly that and went quiet:
verse-translation suggestions in the translation memory, narrator names in the sanad
tree / narrator card, and the admin cache count. `corpus-reads` gives them the same
data through the server. Keep the hardening exactly as it is — do NOT re-add any browser
read policy and do NOT touch any table, policy, other function or bucket.

## What the function does

POST with a signed-in user's JWT (401 without one). Three fixed, read-only actions; it
never accepts a table, column or filter from the caller:
  - passage-translations { passageKey: "quran:2:255", language: "ur" }  -> up to 5 rows
  - narrator-names { rawyIds: [numbers, at most 100] }                   -> rijal rows
  - cache-count {}                                                       -> admins only (403 otherwise)
It uses the service role to read, validates all input first, and keeps the exported
`handle(req)` pattern. Do NOT refactor it into an inline Deno.serve(async (req) => ...).

## Please report back

- The corpus-reads deployed state (deployed, with a timestamp).
- Confirm that calling it with NO Authorization header returns 401, and that
  { "action": "cache-count" } as a non-admin returns 403. If you cannot call it, say so
  plainly.
- That no other function, table, policy or bucket was touched.
```

---

## Notes for you (not for Lovable)

- Lovable syncs from `main`; this reaches it once the PR is merged.
- Until the function is deployed those three screens stay empty, exactly as they are now
  (no errors shown).
- After it is deployed, check once live (signed in): the admin panel's cache count is not 0,
  and (desktop) the sanad tree shows narrator names instead of "name not available".
