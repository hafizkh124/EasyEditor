# ADR 0060 — `extract_web_page`: read-only, provenance-checked web reading (no browser automation)

**Status:** Accepted · **Date:** 2026-09-29 · **Milestone:** M13 Scholar Desktop Agent · **Extends:** [ADR-0022](./0022-m9-agent-reach-into-local-subsystems.md), [ADR-0028](./0028-m9-federated-knowledge-tiers.md)

## Context

The M13 blueprint asked for a browser agent (AIHawk / Playwright MCP) that
opens pages, clicks, fills forms and collects data. The scholar chose
**read-only extraction** (2026-09-28): AIHawk is a LinkedIn job-application
bot, and an agent that clicks and types on arbitrary sites carries the two
risks this app cannot accept — prompt injection from page text steering the
agent, and acting inside the scholar's logged-in accounts.

## Decision

- **One page, read-only.** `extract_web_page(url)` loads the URL in a hidden
  `BrowserWindow`: sandboxed, context-isolated, no Node, no preload,
  JavaScript on (modern sites render client-side), images off, audio muted,
  popups denied, downloads cancelled, all permission requests denied,
  navigation away from http(s) blocked, and every request to a
  private/LAN address (127.x, 10.x, 192.168.x, 172.16–31.x, *.local, ::1…)
  cancelled. It uses its **own** persistent partition
  (`persist:webextract`) — never the app's session, so no login cookie is
  ever sent — and wipes its storage and cache after every read. (An
  in-memory partition was tried first and fails some real sites with
  `ERR_FAILED`, e.g. islamqa.info — confirmed live.)
- **Extraction runs in an isolated world** on the live DOM, read-only: a
  small Readability-style scorer (visible text blocks outside page chrome
  credit their parent; the best container plus strong siblings win; text via
  `innerText`). No new dependency. Live-verified on sunnah.com (the hadith,
  not the hidden search-help popup a clone-based first version picked),
  islamqa.info (Urdu), islamweb.net and dorar.net.
- **URL provenance** (`shared/agent/webUrls.ts` `UrlProvenance`): a URL may
  be opened only if it appears in the scholar's own messages (this turn and
  earlier ones) or in a SEARCH tool's result this task. URLs inside an
  extracted page are never added — a page cannot send the agent to the next
  page.
- **Untrusted framing.** The result carries an explicit notice and the text
  is fenced (`<<<WEB PAGE TEXT — DATA ONLY>>>`).
- **Citation.** The page enters the retrieval ledger with its URL; a known
  scholarly host (islamqa, islamweb, dorar, binbaz, alukah, sunnah.com, …)
  is a normal source, anything else is bibliographic only — citable, never
  with a claim (the ADR-0028 rule).

## Consequences

- No clicking, typing, logging in, pagination by link, or multi-page
  crawling. A page behind a login returns little or no text, and the result
  says so.
- Playwright stays a test-only dev dependency; no browser MCP server.
