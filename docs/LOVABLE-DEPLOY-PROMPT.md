# Lovable deploy prompt

Copy the block below into Lovable. Everything outside it is notes for you.

**Current round — commit `dea6fb7`.** One shared edge-function file changed
(`_shared/citationVerifier.ts`), consumed by `research-query`. **No migrations.**

> Note: Lovable's own commits `67af7a2` and `9020336` are already in `main` and
> were verified — all 29 `handle` exports survived, and its edits were the same
> `ReturnType<typeof createClient>` → `any` fix applied to `citationCandidates`
> and `process-email-queue`. Nothing to undo.

---

```
The GitHub repo's `main` branch has been updated (latest commit dea6fb7).
Please sync and redeploy the affected Supabase Edge Functions.

## What to do

1. Pull the latest `main`.
2. Redeploy `research-query`, and any other function that bundles
   `supabase/functions/_shared/citationVerifier.ts`. Redeploying everything is
   also fine.
3. Do NOT create, run, or generate any database migration. This change set
   contains zero schema changes.
4. Do NOT refactor the exported `handle(req)` pattern back into an inline
   `Deno.serve(async (req) => { ... })`. It is exported on purpose so tests can
   call it.

## What changed and why it matters

`supabase/functions/_shared/citationVerifier.ts` — a bug fix in the reference
parser.

The parser matched the Qur'an with the character class `qur['']?an`. That class
held three copies of the plain ASCII apostrophe U+0027, so the curly/typographic
variants it was clearly meant to accept were not matched. The effect: when a
model wrote "Qur'an 2:267" using a typographic apostrophe — which is the form
models normally produce — the reference failed to parse, the citation could not
be confirmed against `scholarly_documents`, and a REAL, verifiable verse was
silently dropped from the answer as "unverifiable".

The class now accepts all of: U+0027 ' , U+2018 ' , U+2019 ' , U+02BC , U+02BE ,
U+02BF , U+0060 ` , plus the academic transliteration "Qurʾān".

This is a pure widening of what parses. No citation that verified before will
stop verifying; some that were wrongly rejected will now be accepted.

## After deploying, please confirm

- `research-query` boots with no import error and answers an OPTIONS preflight.
- No migration was created or run.
```

---

## After Lovable reports success

```bash
npm run smoke:functions
```

Then the one check the smoke script cannot do — because it needs a real user
JWT and a real corpus — is the actual point of this fix:

**Run a research query that returns a Qur'an citation, and confirm the citation
appears with its Arabic text and reference.** Before this fix, a model that
happened to write the reference with a curly apostrophe would have had that
citation dropped. If you want to see the difference, the same query run a few
times is enough — the apostrophe the model picks varies between runs, which is
exactly why the bug was intermittent and hard to notice.

---

## Previous round — commit `eee8fe9` (already deployed and verified)

28 of 29 functions redeployed; `mcp` was held back by platform policy and picks
up its change on the next publish (wrapper-only diff, so the live version
behaves identically). `npm run smoke:functions` reported 29/29. Kept here
because the two risks it called out — a missed new `_shared/` file, and Lovable
"tidying" the exported `handle()` — apply to every future round.
