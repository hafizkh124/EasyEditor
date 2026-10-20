# Al-Ulama Easy Editor (العُلَمَاء اِیزی ایڈیٹر)

> **AI research and writing environment for scholars — Arabic, Urdu & English**
> *Available as both a web app and a privacy-first local desktop app (Electron)*

[![AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)](https://www.electronjs.org/)
[![Tests](https://img.shields.io/badge/Tests-passing-6BA539?logo=vitest)](https://vitest.dev/)
![Platform](https://img.shields.io/badge/Platform-Web%20|%20Windows%20|%20macOS%20|%20Linux-808080)

The primary user is a mufti or researcher, and the primary device is a phone —
both assumptions drive most of the design decisions recorded in `docs/`.

---

## The workspace (M2–M4)

`/workspace/:documentId` is the main entry point on the web app: a
three-pillar shell where research and writing sit side by side, so the user
never loses context by navigating away.

| Pillar | What it holds |
|---|---|
| **Library** (left) | Projects → documents, plus tabs for `Sources`, `Graph` and `Recipes` |
| **Canvas** (centre) | The TipTap editor, with a selection bubble menu and `/` slash commands |
| **Workbench** (right) | `Research`, `Translate`, `Extract`, `Tasks` and `Trust` tabs — hidden when closed, never unmounted, so a streaming answer survives |

Built on top of that shell:

- **AI Task Library** — 12 built-in tasks (harakat, spelling, paraphrase, summarize,
  citations, auto-format, normalize/formalize/humanize/shorten, section summaries)
  reachable from the bubble menu, slash menu, toolbar and Tasks tab. Users may
  duplicate a built-in task and edit its prompt; there is no free-form prompt box.
- **Long-document chunking** — documents beyond a single request are split at
  heading and sentence boundaries, applied batch by batch with progress, cancel
  and per-run undo. An interrupted run can be resumed after reload, but only if
  the document is unchanged.
- **Trust UI** — every AI run is recorded with its sources and a confidence
  score, shown in the `Trust` tab and on the run card under the canvas.
- **Personal corpus** — upload PDF/DOCX/TXT/MD into your own library; text is
  extracted, chunked and embedded, then fused into citation search as an extra
  ranked channel. Private to the owner by row-level security.
- **Knowledge graph** — extract people, books, places and terms into entity
  cards with backlinks. Look-alike names are only ever *suggested* as duplicates;
  merging is always the user's decision.
- **Recipes** — fixed multi-step pipelines (e.g. normalize → spell-check →
  auto-format) priced in a single pre-flight dialog. The model never chooses the
  steps.
- **Annotations** — margin notes that survive AI edits; if a run rewrites the
  marked text the note is kept and flagged as detached rather than deleted.

## Agent, playbooks & connectors

- **Agent** — a tool-using assistant (about 45 tools) that searches the corpus,
  Shamela, tafsir, hadith and rijal sources, runs zakat and faraid calculators,
  drafts sections (including fatwa mode), typesets print-ready PDFs, compares
  manuscript variants and builds indexes. It asks for approval before editing
  files or documents. Desktop runs the full loop; web runs a reduced one.
- **Playbooks** — 25 named workflows (thesis format, verified citations,
  submission PDF, manuscript edition, fatwa, zakat and faraid, digitise-a-book,
  Urdu formatting, …) managed under Settings → Skills.
- **Connectors Hub** — Shamela, Shamela Cloud, Turath, tafsir, hadith, Dorar,
  rijal, JKHSSN, web, repositories, Ganjoor, Urdu prosody, zakat and faraid.
- **Providers & BYOK** — Gemini, Groq, OpenRouter and OpenAI-compatible
  endpoints; bring-your-own-key works on web and desktop.
- **Book Translation** — a PDF or Shamela source beside its AI translation,
  with translation memory, chunk by chunk.
- **MCP server** — `supabase/functions/mcp` exposes faraid calculation, corpus
  search, takhrij and account tools to external assistants.

## Standalone tools

- **Transcribe** — speech-to-text with AI refinement; long-form audio up to 60
  minutes via client-side chunked transcription; SRT/VTT subtitle export and
  MP3 audiobook export with chapter marks.
- **Speak** — text-to-speech with 6 voice personas.
- **OCR** — image/PDF-to-text with Urdu/Arabic support.
- **Research** — three-mode assistant (Islamic / Custom Sources / General), also
  available inside the Workbench.
- **Translate** — quick translation, plus a full chunk-by-chunk translation
  workspace with translation memory.

Finished OCR and transcription output can be pushed straight into the personal
library with **"کتب خانے میں محفوظ کریں"**.

## Desktop app (M5)

The Electron shell (`npm run dev:electron`) is a privacy-first alternative to
the web app for users who want zero cloud dependency:

- **Local-first storage & search** — SQLite with `sqlite-vec` for offline
  vector search. There is no sync: the local and cloud workspaces are separate
  homes, bridged only by an explicit export/import.
- **BYOK Gemini AI** — bring your own API key; it is encrypted with Electron's
  `safeStorage` (the OS keychain/DPAPI) and never leaves the main process, so
  the renderer never holds the key.
- **Maktaba Shamela 4 native integration** — detects a local Shamela 4
  install, diagnoses it, reads its catalogue from `master.db`, and searches
  its Lucene index through Shamela's own JRE in the main process. No sidecar,
  no `.bat`, no tokens spent. Selected books can be imported into the local
  corpus per book — never wholesale — behind a mandatory cost estimate, and
  each chunk keeps its page and volume so citations can name them.
- **Local voice studio (Python-free)** — offline speech-to-text (Whisper) and
  text-to-speech (Piper, Urdu & Arabic) with segmented synthesis.

The web app and desktop app share the same `src/`. `shared/` is the
runtime-agnostic layer — prompts, chunking, script runs, rank fusion — that
both Deno edge functions and Node/Electron import, so it must never reach for
`Deno.*`, `node:*`, `window`, or `process`. Desktop-only code (IPC handlers,
SQLite schema, voice engines) lives in `electron/`.

## Documentation

| Document | Covers |
|---|---|
| [`docs/SPEC-v2.md`](docs/SPEC-v2.md) | Security, refactor, navigation, research modes, PWA |
| [`docs/SPEC-M2.md`](docs/SPEC-M2.md) | Three-pillar workspace shell |
| [`docs/SPEC-M3.md`](docs/SPEC-M3.md) | Task library, editor menus, Trust UI, chunking |
| [`docs/SPEC-M4.md`](docs/SPEC-M4.md) | Personal corpus, knowledge graph, recipes |
| [`docs/SPEC-M5.md`](docs/SPEC-M5.md) | Electron shell, BYOK, local storage, Shamela, voice studio |
| [`docs/SPEC-M5.9.md`](docs/SPEC-M5.9.md) | Plan for the four unfinished M5 gates (local ingest, Shamela import, native search, mode badge) |
| [`docs/SPEC-M6.md`](docs/SPEC-M6.md) | Library Mode — Shamela-class reader, catalogue browser, and keyword/root search |
| [`docs/SPEC-M8.md`](docs/SPEC-M8.md) | Agentic desktop platform — driving Word/InPage/LibreOffice/Excel/PowerPoint directly, adapter + conversion-graph architecture |
| [`docs/QA-M4.md`](docs/QA-M4.md) | Manual QA checklist for the M4 features |
| [`docs/QA-M5.md`](docs/QA-M5.md) | Manual QA checklist for the M5 desktop build |
| [`docs/SMOKE-TESTS.md`](docs/SMOKE-TESTS.md) | Edge-function liveness suite (`npm run smoke:functions`) |
| [`docs/adr/`](docs/adr/) | Architecture decision records |

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend (web):** Supabase (PostgreSQL, Auth, Edge Functions, Storage)
- **Backend (desktop):** SQLite + `sqlite-vec`, local Lucene index, Electron IPC
- **AI:** Google Gemini, Lovable AI Gateway, ElevenLabs, local Whisper/Piper (desktop)

---

## Getting Started (Development)

### Prerequisites

- Node.js 18+ or Bun

### Installation

```sh
git clone https://github.com/hafizkh124/scribe-studio-app.git
cd EasyEditor
npm install

# Web development server
npm run dev

# Electron desktop shell
npm run dev:electron
```

The web app is available at `http://localhost:8080`.

### Environment Variables

The web app is deployed on **Lovable**, which provisions and manages the
Supabase project itself — its secrets are held on the platform, not here. So a
plain `git clone && npm install && npm run dev` already talks to the managed
backend: `vite.config.ts` carries the managed project's URL, anon key and
project ID as fallbacks, and any `VITE_SUPABASE_*` you set in `.env` overrides
them. The anon key is a publishable key that ships in the client bundle by
design; it is not a secret, and row-level security is what protects the data.

Optional overrides live in `.env` (gitignored — never commit it). Copy
`.env.example` to `.env` to point a local build at a different Supabase project
or to toggle feature flags:

```
VITE_SUPABASE_PROJECT_ID=…
VITE_SUPABASE_PUBLISHABLE_KEY=…
VITE_SUPABASE_URL=https://….supabase.co
```

Edge-function runtime secrets (`LOVABLE_API_KEY`, `GEMINI_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, …) are managed inside Lovable and are **not** read
from `.env`. The `GEMINI_API_KEY` / `INGEST_SHARED_SECRET` entries in
`.env.example` are only for the local Python scripts under `scripts/`.

The desktop app has no equivalent step: Gemini access is BYOK, entered in-app
and stored in the OS keychain.

### Feature Flags

Each milestone ships behind flags, so any pillar can be switched off
independently and the app falls back to the previous milestone's behaviour.
All default to `true` in `.env.example`.

| Flag | Turns off |
|---|---|
| `VITE_TASK_LIBRARY` | AI Task Library, custom tasks, Tasks + Trust tabs |
| `VITE_EDITOR_MENUS` | Bubble menu, slash commands, mobile task sheet |
| `VITE_TASK_CHUNKING` | Long-document chunked runs |
| `VITE_PERSONAL_CORPUS` | Library uploads, ingest, personal citation channel |
| `VITE_KNOWLEDGE_GRAPH` | Entity extraction and the Library `Graph` tab |
| `VITE_RECIPES` | Recipe pipelines and the Library `Recipes` tab |
| `VITE_ANNOTATIONS` | Margin notes |

Edge functions cannot read these flags. `refine-text` always fuses a personal
corpus channel into citations — with `VITE_PERSONAL_CORPUS` off nothing can be
uploaded, so that channel has no rows and results are unchanged.

## Quality & Tests

```sh
npm run typecheck        # TypeScript strict check
npm run test              # Vitest unit test suite
npm run lint               # ESLint check
npm run build               # Production build (web)
npm run pack:electron         # Package desktop executable (unsigned, for local testing)
npm run build:electron         # Build + create installers (electron-builder)
```

## Database Setup (web app)

Run Supabase migrations to set up the database schema:

```sh
npx supabase db push
```

Tables created (selected):

| Table | Purpose |
|---|---|
| `profiles` | User profile data |
| `subscriptions` | Tier and usage tracking |
| `user_roles` | Role-based access control |
| `research_sources` | Saved research documents |
| `user_sessions` | Per-section session history (transcribe / speak / ocr / research) |
| `projects`, `documents`, `document_versions` | Workspace content and version history |
| `task_runs`, `ai_tasks` | AI run log (progress, status, sources) and user-authored tasks |
| `library_items`, `library_chunks` | Personal corpus: uploaded files and their embedded chunks |
| `entities`, `entity_relations` | Knowledge graph |
| `annotations` | Margin notes |
| `recipes` | Multi-step pipeline definitions |

Everything user-owned is protected by row-level security. Personal corpus
search goes through `match_library_chunks`, which is deliberately
`SECURITY INVOKER` so RLS applies — a `SECURITY DEFINER` RPC there would expose
one user's library to another. Edge functions take the user identity from the
JWT and never from the request body.

The desktop app uses its own local SQLite schema instead (see `shared/`); it
does not read from or write to the Supabase tables above.

## Subscription Tiers (web app)

Four tiers: **free** (no access), **basic**, **pro**, **ultra**. Per-tier quota
columns live on the `subscriptions` table; canonical values are defined in
[`src/contexts/SubscriptionContext.tsx`](src/contexts/SubscriptionContext.tsx)
under `TIER_LIMITS`. Edit there to change limits. The desktop app has no
subscription gate — it is BYOK.

## License

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](./LICENSE).
