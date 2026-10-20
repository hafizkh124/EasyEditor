# Changelog

Notable changes to Al-Ulama Easy Editor. Versions follow `package.json`.

## Unreleased

### Public site and discoverability
- New landing page (English, Urdu, Arabic): workspace, research with the Trust
  tab, AI tasks and recipes, agent with 25 playbooks, connectors, personal
  library, voice tools, book translation, desktop app, privacy, audiences,
  pricing note and FAQ (with `FAQPage` JSON-LD).
- Removed the "free monthly quota" claim; the free state has no quota and new
  accounts need admin approval.
- One site-wide JSON-LD graph in `index.html`; correct operating systems,
  prices, licence and GitHub `sameAs`.
- `scripts/seo.mts`: generates `sitemap.xml` (lastmod, full hreflang) and writes
  per-locale pages after `vite build` with the right `lang`/`dir`, title,
  description, canonical, hreflang and Open Graph tags.
- Rewrote `llms.txt`, added `llms-full.txt`, opened `robots.txt` to AI crawlers
  for public pages, refreshed the PWA manifest description.
- Maktaba Shamila guide rewritten with verified facts; About page covers the
  agent, connectors and desktop app.
- README documents the agent, playbooks, connectors, BYOK and MCP server.

## 2.0.10
Baseline for this changelog. See `docs/` and git history for earlier work.
