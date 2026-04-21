# Scribe Studio v2 — Spec-Driven Development Document

**Status:** Approved · **Version:** 2.0.0-draft · **Date:** 2026-04-20
**Owner:** Hafiz Khizar Hayat · **Author:** Engineering
**Branch target:** `main` · **Estimated effort:** 12–14 working days

---

## 1. Overview

Scribe Studio is a React 18 + TypeScript + Vite AI toolkit (Transcribe, Speak, OCR, Research) backed by Supabase and integrated with Gemini + ElevenLabs. This document specifies the v2 refactor and feature expansion.

### 1.1 Problem Statement
The v1 audit surfaced:
- **Critical security exposure** — API keys committed to the repository.
- **Maintainability debt** — two 800+ line page components, 24 `any` types.
- **UX gaps** — flat sidebar, no session history, no mode-specific research flows, short-form transcription only.
- **Performance risks** — un-virtualized chat lists, no service worker.

### 1.2 Goals
1. Eliminate critical security issues (Phase 0).
2. Make the codebase maintainable (Phase 1).
3. Deliver mobile-first navigation with per-section session history (Phase 2).
4. Add mode-driven research flows: Spelling Correction, Citations, Both, Normal (Phase 3).
5. Support up to 1-hour transcription with progress feedback (Phase 4).
6. Ship as a real PWA with offline shell (Phase 5).

### 1.3 Non-Goals
- Multi-tenant / workspace model.
- Payment integration changes.
- New AI providers beyond Gemini + ElevenLabs.
- Desktop (Electron) packaging.
- Real-time collaboration.

---

## 2. User Stories

### 2.1 Content Editor (Writer)
- *As a writer,* I want to paste text and only fix spelling so I don't get unrelated reformatting.
- *As a writer,* I want to paste text and only get citations added, preserving my wording.
- *As a writer,* I want to combine spelling + citations in one pass.
- *As a writer,* I want my past sessions visible in the sidebar so I can resume work.

### 2.2 Researcher
- *As a researcher,* I want to switch between General and Islamic research modes via a top tab without losing my session.
- *As a researcher,* I want Islamic-only controls (Dorar, AlQuran, Sunnah, Quran.com, Madhhab filter) to appear only in Islamic mode.
- *As a researcher,* I want a unified composer where I can toggle spelling/citation assistance per message.

### 2.3 Transcriber
- *As a user,* I want to transcribe a 1-hour recording in one go with a live progress bar and a cancel button.
- *As a user,* I want my transcription sessions saved so I can return to them later.

### 2.4 Account Holder
- *As a user,* I want one page (My Profile) that shows my plan, usage, billing, and logout.
- *As a user,* I want Settings to contain only language switching — no account bloat.

### 2.5 Mobile User (primary persona)
- *As a mobile user,* every screen must work one-handed with a drawer sidebar.
- *As a mobile user,* long-form transcription progress must be visible without scrolling.

---

## 3. Functional Requirements

### FR-1 Research Modes (Spelling / Citations / Normal)
- FR-1.1 Multi-select chip bar above the research composer: `[املاء]` `[حوالہ جات]`.
- FR-1.2 Neither selected = normal research behavior (default).
- FR-1.3 Only Spelling = return corrected text with **inline highlighted changes** (insertions green, deletions struck-through red). No side-by-side diff.
  - FR-1.3.1 **Copy options** exposed via a split-button / dropdown on the response:
    - **Copy clean** (default) — copies only the corrected text, no markup.
    - **Copy with highlights** — copies a marked-up version that preserves the error indicators (e.g., HTML `<del>` + `<ins>` for rich-text targets, or Markdown `~~old~~ **new**` for plain-text targets).
  - FR-1.3.2 Copy action uses the Clipboard API `write()` with both `text/plain` and `text/html` MIME types so pastes into Word / Google Docs keep the highlights when "Copy with highlights" is chosen.
- FR-1.4 Only Citations = return original wording with citations appended.
  - FR-1.4.1 **Citation format** (inline, in brackets, placed at the end of the supporting passage):
    - Arabic text (original), immediately followed by its translation in the user's active language (Urdu/English), followed by the source reference in brackets — in this order. Example:
      > «إنما الأعمال بالنيات» — "Actions are judged by intentions" [Sahih al-Bukhari, Hadith 1].
  - FR-1.4.2 **Copy options** exposed via a split-button / dropdown on the response:
    - **Copy full (Arabic + translation + reference)** — *default*.
    - **Copy reference only** — strips the Arabic passage and translation, keeps the bracketed source reference only.
  - FR-1.4.3 Citation data returned by the edge function must be structured so the client can assemble either copy variant without re-querying:
    ```ts
    type Citation = {
      index: number;
      arabic: string;
      translation: string;
      reference: string;   // e.g. "Sahih al-Bukhari, Hadith 1"
      source_url?: string;
    }
    ```
- FR-1.5 Both = corrected text + citations (applies FR-1.3.1 and FR-1.4.2 copy behaviors together).
- FR-1.6 Mode state is per-message (resets to last-used after send, persisted to localStorage).
- FR-1.7 System prompts live in `src/lib/prompts/{spelling,citations,combined,normal}.ts`.
- FR-1.8 Edge function accepts `modes: Array<'spelling' | 'citations'>` and routes to correct prompt.

### FR-2 Sidebar & Navigation
- FR-2.1 Sidebar layout (top → bottom): brand → section nav → history (context-aware) → profile button.
- FR-2.2 Section nav items, in this order: **Research, Transcribe, OCR, Speak, Admin** (Admin conditional on role).
- FR-2.3 History list shows sessions of the **currently active section only**.
- FR-2.4 Each history item: auto-generated title, relative timestamp, rename + delete on hover/long-press.
- FR-2.5 Sidebar is collapsible; collapsed state persists in `localStorage('sidebar.collapsed')`.
- FR-2.6 On mobile (`< md`), sidebar is a drawer (shadcn `Sheet`).
- FR-2.7 Profile button at sidebar bottom opens `/profile`.

### FR-3 Long-Form Transcription
- FR-3.1 Support audio files up to 60 minutes (hard cap enforced client + server).
- FR-3.2 Files > 5 minutes are auto-chunked into ~5-minute segments at silence boundaries when possible.
- FR-3.3 Progress bar shows phases: `Uploading` → `Transcribing X of Y` → `Finalizing`.
- FR-3.4 Cancel button aborts in-flight chunks and deletes partial session.
- FR-3.5 Chunks are reassembled in order; timestamps preserved across boundaries.
- FR-3.6 Tier quota checked upfront: reject if remaining minutes < audio duration.
- FR-3.7 Session persisted to `user_sessions` as progress advances (survives page refresh).

### FR-4 Research Mode Switcher (Islamic / Custom Sources / General)
- FR-4.1 Segmented control at top of Research page with **three tabs**, in this order:
  `[Islamic] [Custom Sources] [General]`. No sidebar entries for these modes.
- FR-4.2 Switching modes prompts confirmation if there is an unsaved draft.
- FR-4.3 Shared options (always visible across all three tabs): language selector, spelling/citation chips (FR-1).
- FR-4.4 **Islamic mode**:
  - FR-4.4.1 All supported domains (Dorar, AlQuran, Sunnah, Quran.com) are selected automatically and queried in parallel. **No checklist is shown** to the user.
  - FR-4.4.2 Madhhab filter remains available as a single-select dropdown.
  - FR-4.4.3 No file upload; no URL sources.
- FR-4.5 **Custom Sources mode**:
  - FR-4.5.1 Only user-uploaded files (PDF / DOCX / TXT) are accepted as sources.
  - FR-4.5.2 **No URL inputs** are shown.
  - FR-4.5.3 No web search; no Islamic domains.
- FR-4.6 **General mode**:
  - FR-4.6.1 Web search is the only source (always on).
  - FR-4.6.2 No file upload; no URL inputs; no Islamic domains.

### FR-5 Unified Profile Page
- FR-5.1 Route `/profile` contains: account info, current plan + upgrade CTA, usage meters (Transcribe / Speak / OCR / Research), billing history (if applicable), danger zone (delete account), logout.
- FR-5.2 Logout buttons anywhere else in the app are removed.

### FR-6 Settings Page Reduction
- FR-6.1 Route `/settings` contains **only** language selection.
- FR-6.2 All other previous settings migrated to `/profile`.

### FR-7 Session History (cross-cutting)
- FR-7.1 Retention: **unlimited for all tiers**.
- FR-7.2 Sessions exist for Transcribe, Speak, OCR, Research.
- FR-7.3 Session title auto-generated from first prompt/filename; user-editable.

---

## 4. Non-Functional Requirements

| # | Category | Requirement |
|---|---|---|
| NFR-1 | Security | No secrets in repo; Supabase & Gemini keys rotated; `.env` gitignored |
| NFR-2 | Performance | Research chat handles 500+ messages without jank (virtualized) |
| NFR-3 | Performance | First Contentful Paint < 2s on mid-tier mobile, 4G |
| NFR-4 | Accessibility | WCAG 2.1 AA — all interactive elements keyboard-reachable, labeled |
| NFR-5 | Responsiveness | **Mobile-first**; all features usable at 360px width |
| NFR-6 | RTL | Full Urdu RTL across new components; bidi-aware text detection |
| NFR-7 | PWA | Installable on iOS/Android/desktop; offline shell |
| NFR-8 | Type Safety | 0 `any` types in `src/pages` and `src/contexts` |
| NFR-9 | Bundle | Main bundle < 250 KB gzip (analyzer in CI) |
| NFR-10 | Observability | Every API call tagged with a request ID, logged on error |

---

## 5. Technical Design

### 5.1 Architecture Overview
No framework change. Continue React 18 + Vite + shadcn/ui + Supabase. Add:
- `vite-plugin-pwa` for service worker.
- `react-window` for virtualized lists.
- `rollup-plugin-visualizer` for bundle analysis.

### 5.2 Folder Structure (new/changed)
```
src/
├── components/
│   ├── AppLayout.tsx                    (rewritten)
│   ├── SidebarHistory.tsx               (new)
│   ├── Sidebar/
│   │   ├── SectionNav.tsx               (new)
│   │   └── ProfileButton.tsx            (new)
│   └── research/
│       ├── ResearchChat.tsx             (new, from Research.tsx)
│       ├── ResearchComposer.tsx         (new)
│       ├── SourceManager.tsx            (new)
│       ├── ResearchModeSwitcher.tsx     (new)
│       ├── ModeChips.tsx                (new — spelling/citations)
│       ├── IslamicOptions.tsx           (new)
│       └── GeneralOptions.tsx           (new)
├── hooks/
│   ├── useSessionHistory.ts             (new)
│   ├── useLimitReached.ts               (new)
│   └── useSidebarCollapsed.ts           (new)
├── lib/
│   ├── audio/
│   │   ├── chunker.ts                   (new)
│   │   └── transcribeLongForm.ts        (new)
│   ├── prompts/
│   │   ├── spelling.ts                  (new)
│   │   ├── citations.ts                 (new)
│   │   ├── combined.ts                  (new)
│   │   └── normal.ts                    (new)
│   └── logger.ts                        (new — request IDs)
└── pages/
    ├── Research.tsx                     (shrunk to composition)
    ├── Admin.tsx                        (shrunk to composition)
    ├── Profile.tsx                      (redesigned)
    ├── Settings.tsx                     (reduced to lang only)
    └── Transcribe.tsx                   (progress bar, chunked)
```

### 5.3 Data Model (Supabase)

#### New table: `user_sessions`
```sql
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('transcribe','speak','ocr','research')),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX user_sessions_user_section_updated_idx
  ON user_sessions (user_id, section, updated_at DESC);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner read"   ON user_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "owner write"  ON user_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "owner update" ON user_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "owner delete" ON user_sessions FOR DELETE USING (auth.uid() = user_id);
```

#### Existing `research_sessions` → migrate into `user_sessions` with `section='research'`.

### 5.4 API Contracts

#### Research edge function (extended)
```ts
// Request
POST /functions/v1/research
{
  query: string,
  mode: 'islamic' | 'custom' | 'general',     // 3 modes (FR-4)
  modes: Array<'spelling' | 'citations'>,     // assist flags (FR-1)
  sources?: Array<{ type: 'file', value: string }>, // custom mode only
  session_id?: string,
  options: {
    madhhab?: string        // islamic only
    // islamic: domains auto-selected server-side, not client-configurable
    // general: web_search is implicit (always on)
  }
}

// Streamed response (SSE)
data: { "type": "token", "text": "..." }
data: { "type": "citation", "index": 1, "arabic": "...", "translation": "...", "reference": "...", "source_url": "..." }
data: { "type": "correction", "range": [42,48], "replacement": "..." }
data: { "type": "done", "session_id": "..." }
```

#### Long-form transcribe (new)
```ts
POST /functions/v1/transcribe/init
{ duration_seconds: number, mime: string, language: 'en' | 'ur' }
→ { upload_id: string, chunks: Array<{ index, upload_url }> }

POST /functions/v1/transcribe/finalize
{ upload_id: string }
→ { transcript: string, segments: [...] }

// Progress via WebSocket / polling on /transcribe/status/:upload_id
```

### 5.5 Spelling Correction Rendering
- Response shape: `{ corrected: string, changes: Array<{ start: number, end: number, original: string, corrected: string }> }`
- Client renders `corrected` with `<ins>` (green background) wrapping replaced ranges and hover-reveals `original` (tooltip).
- **Copy behavior (FR-1.3.1):**
  - *Copy clean* → `navigator.clipboard.writeText(corrected)`.
  - *Copy with highlights* → build both `text/html` (`<del>old</del><ins>new</ins>`) and `text/plain` (`~~old~~ **new**`) representations, write via `navigator.clipboard.write([new ClipboardItem({...})])`.

### 5.6 Citation Rendering & Copy
- Server returns structured citations (see `Citation` type in FR-1.4.3).
- Inline rendering: `«{arabic}» — "{translation}" [{reference}]` at end of the supporting sentence.
- **Copy behavior (FR-1.4.2):**
  - *Copy full* → builds the full `«arabic» — "translation" [reference]` string for each citation.
  - *Copy reference only* → builds only ` [reference]` appended to the base text (Arabic + translation stripped).

---

## 6. UX Specifications

### 6.1 Sidebar (desktop expanded, ≥ md)
```
┌───────────────────────────────┐
│ [◀]  Scribe Studio           │
├───────────────────────────────┤
│ 🔎  Research                  │
│ 🎙  Transcribe                │
│ 👁  OCR                       │
│ 🔊  Speak                     │
│ 🛡  Admin                     │
├───────────────────────────────┤
│ History                    [+]│
│ • Lecture on Tafsir  2h       │
│ • Article draft      yesterday│
│ • Interview #3       3d       │
│ ...                           │
├───────────────────────────────┤
│ 👤  My Profile                │
└───────────────────────────────┘
```

### 6.2 Sidebar (mobile drawer)
- Trigger: hamburger icon top-left.
- Full-height `Sheet` from left; same structure; swipe-to-close.
- Section tap → navigate + close drawer.

### 6.3 Research Composer with Mode Chips
```
┌───────────────────────────────────────────┐
│ [Islamic] [Custom Sources] [General]      │  ← 3-tab segmented top
├───────────────────────────────────────────┤
│ <mode-specific options panel>             │
│  Islamic:  Madhhab ▼                      │
│  Custom:   📎 Upload file                 │
│  General:  (web search auto)              │
├───────────────────────────────────────────┤
│ [ املاء ] [ حوالہ جات ]   ← toggle chips  │
│ ┌─────────────────────────────────────┐   │
│ │ Type your query...                  │   │
│ └─────────────────────────────────────┘   │
│                              [Send ▶]     │
└───────────────────────────────────────────┘
```

### 6.4 Transcribe Progress
```
Uploading audio ████████░░░░░░░░  48%
Transcribing chunk 5 of 12
Elapsed 02:14 · ETA ~03:30
[ Cancel ]
```

---

## 7. Phased Rollout

### Phase 0 — Security Hotfix
**Blocker before any other phase.**
- [ ] **User:** rotate Supabase publishable key via dashboard.
- [ ] **User:** rotate Gemini API key via Google AI Studio.
- [ ] **Claude:** remove hardcoded fallbacks from `vite.config.ts`.
- [ ] **Claude:** strip keys from `.env`, add `.env` to `.gitignore`.
- [ ] **Claude:** update README with env setup.
**Exit criteria:** `git grep` for the old keys returns nothing; app still boots with fresh `.env`.

### Phase 1 — Foundation Refactor
- [ ] Split `Research.tsx` (838 → ≤ 300 lines per file).
- [ ] Split `Admin.tsx` (774 → ≤ 300 lines per file).
- [ ] Replace all `any` in `src/pages` and `src/contexts`.
- [ ] `useLimitReached()` hook; DRY quota checks in 4 pages.
- [ ] Fix hook deps: `OCR.tsx:90`, `Settings.tsx:44`.
- [ ] Add `src/lib/logger.ts` with request IDs.
**Exit criteria:** `npm run lint` clean of errors; `npm run typecheck` clean; existing smoke tests pass.

### Phase 2 — Navigation Overhaul
- [ ] `user_sessions` migration applied.
- [ ] `AppLayout` rebuilt: section nav top, history middle, profile bottom.
- [ ] `SidebarHistory` + `useSessionHistory` generic over `section`.
- [ ] Collapsible sidebar with persisted state.
- [ ] Mobile drawer.
- [ ] `/profile` redesigned with plan + usage + billing + logout.
- [ ] `/settings` reduced to language.
**Exit criteria:** All sections show correct history; mobile 360px usable; lighthouse a11y ≥ 90.

### Phase 3 — Research Upgrades
- [ ] Top segmented control for General/Islamic.
- [ ] Adaptive options panel.
- [ ] Mode chips (Spelling, Citations, Both, Normal).
- [ ] Prompt templates in `lib/prompts/`.
- [ ] Edge function accepts `modes[]`.
- [ ] Inline highlighted corrections rendered.
**Exit criteria:** Each mode combination produces expected output; no Islamic controls leak into General mode.

### Phase 4 — Long-Form Transcription
- [ ] Audio chunker using Web Audio API.
- [ ] Orchestrator with progress events.
- [ ] Progress bar UI + cancel.
- [ ] Tier quota enforcement.
- [ ] Session persistence during transcription.
**Exit criteria:** 60-minute audio transcribes end-to-end; cancel leaves no orphaned rows.

### Phase 5 — Performance & PWA
- [ ] `react-window` virtualization on Research chat.
- [ ] Throttled auto-scroll.
- [ ] `vite-plugin-pwa` with Workbox runtime caching.
- [ ] Images converted to WebP.
- [ ] Bundle analyzer wired; budget enforced.
**Exit criteria:** Lighthouse PWA ≥ 90, Performance ≥ 85 on mid-tier mobile.

### Phase 6 — Polish
- [ ] ARIA labels on all icon buttons.
- [ ] Skip-to-main link.
- [ ] Skeleton loaders on all async panels.
- [ ] Improved RTL detection (full-text bidi).
- [ ] Client-side debounce on submit buttons.

### Phase 7 — Tests & Docs
- [ ] Unit tests for `useSessionHistory`, `useLimitReached`.
- [ ] Integration test for chunked transcribe.
- [ ] Update README + add ADRs for major decisions.

---

## 8. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Gemini API does not reliably handle 1-hour audio in one call | High | Chunking on client; graceful fallback with explicit chunk limit |
| Edge function 60s timeout during long transcribe | High | Chunking + stateless per-chunk calls |
| Supabase migration breaks existing research sessions | High | Write a data-migration script with rollback; stage on a branch DB first |
| Sidebar redesign confuses existing users | Medium | In-app tooltip on first visit after upgrade |
| Mobile drawer conflicts with iOS safe-area | Medium | Explicit safe-area CSS; test on iOS Safari |
| Bundle size grows with `react-window` + PWA | Low | Lazy-load virtualization; Workbox tree-shaken |
| Rotating keys breaks prod | Medium | Rotate in staging first; keep old key active briefly for overlap |

---

## 9. Acceptance Criteria (v2 ship gate)

- [ ] No secrets in repo (`git log -p | grep` for old keys: empty).
- [ ] 0 TypeScript errors, 0 ESLint errors.
- [ ] Research page ≤ 300 lines per file.
- [ ] Research modes (spelling/citations/both/normal) produce distinct, correct outputs.
- [ ] Three research tabs (Islamic / Custom Sources / General) render mode-appropriate options only.
- [ ] Islamic mode auto-queries all domains with no checklist exposed to the user.
- [ ] Custom Sources mode accepts only file uploads (no URL inputs visible).
- [ ] Spelling response supports both "Copy clean" and "Copy with highlights" with working rich-text paste.
- [ ] Citation response supports both "Copy full" and "Copy reference only" copy modes.
- [ ] Sidebar section order: Research, Transcribe, OCR, Speak, Admin.
- [ ] Sidebar: sections top, history middle, profile bottom; collapsible; mobile drawer.
- [ ] History persists across reloads; unlimited retention.
- [ ] 60-minute audio transcribes with visible progress; cancel works cleanly.
- [ ] `/profile` contains all account controls; `/settings` only language.
- [ ] Lighthouse: PWA ≥ 90, Performance ≥ 85, Accessibility ≥ 90 on mobile.
- [ ] All new features render correctly at 360px width, RTL and LTR.

---

## 10. Out of Scope (explicitly deferred)

- Multi-user workspaces / teams.
- Real-time collaborative editing.
- Desktop app (Electron).
- Native mobile apps.
- Additional AI providers.
- Advanced billing (invoices, tax, refunds beyond current flow).
- Payment method changes.

---

## 11. Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-20 | User rotates keys, Claude removes from repo | Separation of concerns; user holds dashboards |
| 2026-04-20 | Inline highlighted corrections (not side-by-side diff) | User preference; less visual overhead |
| 2026-04-20 | Unlimited history retention for all tiers | Simplicity; user priority over cost optimization |
| 2026-04-20 | Mobile-first design priority | Primary audience is mobile users |
| 2026-04-20 | Phase-by-phase execution with review gates | Risk mitigation; allow reorder if justified |
| 2026-04-20 | Keep `/settings` separate from `/profile` | Quick language access warrants dedicated route |
| 2026-04-20 | Spelling response offers two copy modes (clean / with highlights) | Users need both a ready-to-paste clean text and a review-style highlighted version |
| 2026-04-20 | Citation response: Arabic + translation + bracketed reference; two copy modes | Scholarly use needs full evidence block; drafting use needs reference only |
| 2026-04-20 | Research split into 3 tabs: Islamic / Custom Sources / General | Clearer mental model than a binary toggle; Custom Sources separates user corpus from the web |
| 2026-04-20 | Islamic mode auto-selects all domains (no checklist) | Reduces friction for the primary scholarly use case |
| 2026-04-20 | Sidebar order: Research → Transcribe → OCR → Speak → Admin | Matches user's priority of features |

---

## 12. Glossary

- **Mode chip:** multi-select toggle above the research composer (Spelling, Citations).
- **Section:** top-level feature area (Transcribe / Speak / OCR / Research / Admin).
- **Session:** persisted per-section interaction history item.
- **Chunk:** ~5-minute audio slice for long-form transcription.
- **RTL:** right-to-left script rendering (Urdu / Arabic).
- **PWA:** Progressive Web App — installable with offline shell.

---

*End of specification. Implementation begins at Phase 0 upon approval.*
