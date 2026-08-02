# SPEC-M6 — Library Mode: Shamela-Class Reader & Catalogue

> **Status:** Draft · **Date:** 2026-08-02 · **Base:** [SPEC-M5.md](./SPEC-M5.md), [SPEC-M5.9.md](./SPEC-M5.9.md)
>
> M5 delivered Shamela detect/search/import on desktop. M6 transforms EasyEditor from a document editor with Shamela sidecar into a **full Arabic library application** that surpasses Maktaba Shamela 4 in UI/UX and features.

---

## 1. Context

M5.9 completed the data pipeline: Shamela books can be detected, searched, imported, and read page-by-page. But there is **no reader UI**, **no library browser**, **no home screen**, **no FTS keyword search**, **no root search**, and **no AI integration in the reader**.

### 1.1 Design Principles

1. **Library Mode lives inside the existing workspace** — no separate app. The LibraryPanel gains new tabs; the CanvasPanel becomes the reader.
2. **All UI goes through `getBackend()`** — no direct Supabase calls. Desktop uses `localBackend` (SQLite via IPC).
3. **Shamela remains read-only** — never write to Shamela's databases.
4. **Arabic-first, not Arabic-only** — full RTL support, but Urdu and English content must render correctly.
5. **Toolbar surpasses Shamela** — more actions (AI assist, split view, note-taking, export) with better UX.

---

## 2. Non-Goals

- Cloud sync of library data
- Shamela book downloading/PDF caching
- Writing to or modifying Shamela databases
- Mobile/tablet responsive layout (desktop only for M6)
- Multi-user library features

---

## 3. Architecture

### 3.1 Component Map

```
LibraryPanel (Pillar 1)
├── Tab: Home          ← NEW (Phase 1)
├── Tab: Docs          ← existing
├── Tab: Browse        ← NEW (Phase 4) — Shamela catalogue tree
├── Tab: Search        ← NEW (Phase 5-6) — keyword + root search
├── Tab: Favorites     ← NEW (Phase 8)
├── Tab: Sources       ← existing
├── Tab: Graph         ← existing (flag-gated)
└── Tab: Recipes       ← existing (flag-gated)

CanvasPanel (Pillar 2)
├── Default: RichEditor (TipTap) — existing
└── Reader mode: ShamelaReader ← NEW (Phase 2-3)

WorkbenchPanel (Pillar 3)
├── Tab: AI Reader     ← NEW (Phase 7)
├── Tab: Notes         ← NEW (Phase 8)
└── existing tabs...
```

### 3.2 Schema Additions

```sql
-- Track when library items were last accessed (Phase 1)
CREATE TABLE IF NOT EXISTS document_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES library_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_access_log_item ON document_access_log(item_id);
CREATE INDEX IF NOT EXISTS idx_access_log_time ON document_access_log(accessed_at DESC);

-- Add updated_at to library_items
-- (Applied via migration: ALTER TABLE library_items ADD COLUMN updated_at TEXT)
```

---

## 4. Phases

### Phase 1: Home Screen (Days 1–2)
Dashboard with recent books, category shortcuts, library stats.

### Phase 2: Reader Core (Days 3–6)
Full reader with page text, TOC sidebar, toolbar, navigation.

### Phase 3: Typography & Reading Settings (Day 7)
Arabic-optimized reading with customizable fonts, sizes, colors.

### Phase 4: Library Browser (Days 8–10)
Browse Shamela's 8,593 books by category tree, author, or period.

### Phase 5: Keyword Search (Days 11–12)
FTS5 keyword search across imported books.

### Phase 6: Root Search (Days 13–14)
Arabic root search using Shamela's S2.db.

### Phase 7: Reader AI Panel (Days 15–17)
AI-powered reading assistant (explain, summarize, quiz).

### Phase 8: Favorites & Progress (Days 18–19)
Reading progress tracking, bookmarks, favorites.

### Phase 9: Split View (Days 20–22)
Side-by-side book comparison.

### Phase 10: PDF, Covers, Authors (Days 23–29)
Book covers, author browser, PDF viewer.

---

## 5. Toolbar — Surpassing Shamela

EasyEditor reader toolbar (15+ actions):
- Back/Forward, TOC, Search, Copy, Bookmark, Settings, AI, Split, Note, Export, PDF, TTS
- Modern Lucide icons, keyboard shortcuts, context-aware, responsive

---

## 6. Exit Criteria

### General
- [ ] `npm run typecheck && npm run test && npm run lint && npm run build` — all pass
- [ ] `npm run build:electron` succeeds
- [ ] All RTL text displays correctly
- [ ] No regressions in existing features
