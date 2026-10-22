# ADR 0062 — Connectors: presets, in-chat suggestions, a library, and Turath as the portable Shamela

**Status:** Accepted · **Date:** 2026-10-23 · **Milestone:** QA / UX recovery · **Extends:** [ADR-0037](./0037-connectors-hub-and-curated-registry.md), [ADR-0044](./0044-cloud-shamela-connector.md), [ADR-0054](./0054-turath-connector-cache-and-routing.md)

## Context

The registry holds 15 connectors (`shared/agent/connectors.ts`). Settings → Connectors shows them as one flat, categorised grid of toggles. A scholar cannot tell which to switch on or off, and most users should never need to: the agent already narrows tools by intent (ADR-0038).

Shamela is reached three ways — a local bridge (needs the Shamela install and a JRE), `shamela-cloud` (OAuth, quotas) and Turath (no install, no credentials). The first two make "does this device have Shamela, and is it connected?" a question the user has to answer. On web the question never arises: Tier T (Turath) already serves every account.

## Decision

### 1. Turath is the portable Shamela; local and cloud become "Advanced"

`shamelaRouter.ts` already tries local → cloud → Turath among the *enabled* transports, and a failing transport falls through. So on a device with no Shamela, Turath is already what answers. We keep that order on purpose: a scholar who did install Shamela locally gets the fast, offline, exact-page result, and we do not silently change what their citations point at.

What changes is what the user is asked to think about:

- `shamela` and `shamela-cloud` get `advanced: true`. The Hub hides them behind an **Advanced** section (collapsed by default) with a line saying Turath already covers every device.
- Defaults are **not** flipped. Making `shamela` `defaultOff` would, for existing desktop users with no stored choice, silently turn off a working local library on the next release. If that is wanted later, it needs a one-time migration that writes `shamela: true` when an install is detected.
- Turath keeps its cache, throttle, `TURATH_ENABLED` kill-switch and silent degradation (ADR-0054). It remains an unofficial API; this ADR accepts that risk with those mitigations.

### 2. Presets

A preset is a named, exact set of connectors (`shared/agent/connectorPresets.ts`, pure):

| id | enables |
|---|---|
| `research` | turath, tafsir, lexicon, hadith, dorar, rijal, jkhssn |
| `literature` | lexicon, ganjoor, urdu-prosody |
| `web` | web, repositories |
| `calculators` | zakat, faraid |
| `everything` | every connector |

Applying a preset turns its members **on** and leaves the rest as they are (additive — choosing "Literature" must not switch off a scholar's hadith sources). `matchPreset(merged)` reports which preset is fully on, so the Hub can show it as selected. The Advanced Shamela transports are in no preset: they are a deployment choice, not a topic.

### 3. Suggestions in the composer

`suggestConnectors(text, isOn)` (`shared/agent/connectorSuggestions.ts`, pure) reuses `matchDomains` — the same keyword map the agent's intent gate uses — and returns the connectors the question is about that are currently **off**. The composer shows one card: "This looks like a hadith question — turn on «Hadith»?" with **Enable** and **Not now**.

- Enable writes the per-project override (the same call as the `+` popover), so it is visible and reversible there.
- Not now remembers the dismissal for that connector for the session; it never re-asks in the same chat.
- Nothing is enabled without a click. A connector that sends text to a third party (`web`, `repositories`, `ganjoor`) is described as such in the card.
- It suggests at most two connectors, only when the text has a real keyword hit, and never for `shamela*` (Section 1).

We deliberately do this in the renderer, before sending, not as an agent round-trip: the agent cannot enable a connector mid-run without a consent step, and a pre-send card costs no model call.

### 4. Library

Settings → Connectors is split in two:

- **My connectors** — the enabled ones, grouped by category, with health and a switch.
- **Library** — every connector that is *not* enabled, as showcase cards (what it does, what leaves the device, one **Add** button). Adding moves it to My connectors; **Remove** on a card moves it back.

This is the "Skills-style library" over the curated registry: any number of connectors can be listed without lengthening the page people use daily.

### 5. User-authored connectors — designed, not built here

Letting a user register their own source needs: a `user_connectors` table with RLS (`user_id = auth.uid()`), and an edge function that performs the call. The call must go through our server, not the browser, which makes it an SSRF surface. Minimum requirements before it ships:

1. https only; reject IP literals, `localhost`, and private/link-local ranges after DNS resolution (and re-check on redirect — no redirects followed).
2. Fixed request shape (GET with a `{q}` template, JSON response, size and time caps, no user headers except an optional API key stored server-side).
3. Output is treated as untrusted text: it enters the agent as a tool result, never as instructions; results are labelled with the connector's name.
4. Per-user rate limit and a kill-switch; per-connector consent card showing the host.

It also needs a Supabase migration and an edge deployment through Lovable, which cannot be verified from this repo. It is therefore a separate follow-up, not part of this change. `Connector.reviewedEndpoint?: never` stays unused until then.

## Consequences

- A new scholar sees five topic presets and a "Library", not fifteen switches.
- Nothing changes for how the agent gates tools; suggestions only help the user flip the same switches the `+` popover already has.
- Web has no connector UI today (the Hub needs `window.electronAPI`); this ADR changes desktop only. Web already routes classical search through Turath (Tier T).
- Presets are additive, so "applying" one is never destructive; a scholar can still see and change every individual switch under the Library and category sections.
