# Easy Editor

An AI research and writing environment for scholars, supporting **Urdu, Arabic
and English**. The primary user is a mufti or researcher, and the primary device
is a phone — both assumptions drive most of the design decisions recorded in
`docs/`.

## The workspace (M2–M4)

`/workspace/:documentId` is the main entry point: a three-pillar shell where
research and writing sit side by side, so the user never loses context by
navigating away.

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

## Standalone tools

- **Transcribe** — speech-to-text with AI refinement; long-form audio up to 60
  minutes via client-side chunked transcription.
- **Speak** — text-to-speech with 6 voice personas.
- **OCR** — image/PDF-to-text with Urdu/Arabic support.
- **Research** — three-mode assistant (Islamic / Custom Sources / General), also
  available inside the Workbench.
- **Translate** — quick translation, plus a full chunk-by-chunk translation
  workspace with translation memory.

Finished OCR and transcription output can be pushed straight into the personal
library with **"کتب خانے میں محفوظ کریں"**.

## Documentation

| Document | Covers |
|---|---|
| [`docs/SPEC-v2.md`](docs/SPEC-v2.md) | Security, refactor, navigation, research modes, PWA |
| [`docs/SPEC-M2.md`](docs/SPEC-M2.md) | Three-pillar workspace shell |
| [`docs/SPEC-M3.md`](docs/SPEC-M3.md) | Task library, editor menus, Trust UI, chunking |
| [`docs/SPEC-M4.md`](docs/SPEC-M4.md) | Personal corpus, knowledge graph, recipes |
| [`docs/QA-M4.md`](docs/QA-M4.md) | Manual QA checklist for the M4 features |
| [`docs/adr/`](docs/adr/) | Architecture decision records (0001–0005) |

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions, Storage)
- **AI:** Google Gemini 2.5 Flash, Lovable AI Gateway, ElevenLabs

## Getting Started

### Prerequisites

- Node.js 18+ or Bun

### Installation

```sh
git clone <YOUR_GIT_URL>
cd EasyEditor
npm install
npm run dev
```

The app will be available at `http://localhost:8080`.

### Environment Variables

This project is deployed on **Lovable**, which provisions and manages the
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

### Feature Flags

Each milestone ships behind flags, so any pillar can be switched off
independently and the app falls back to the previous milestone's behaviour.
All default to `true` in `.env.example`.

| Flag | Turns off |
|---|---|
| `VITE_WORKSPACE_SHELL` | The whole three-pillar workspace (reverts to standalone pages) |
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

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (port 8080) |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint source files |
| `npm run typecheck` | Type-check without emitting |

## Database Setup

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

## Subscription Tiers

Four tiers: **free** (no access), **basic**, **pro**, **ultra**. Per-tier quota
columns live on the `subscriptions` table; canonical values are defined in
[`src/contexts/SubscriptionContext.tsx`](src/contexts/SubscriptionContext.tsx)
under `TIER_LIMITS`. Edit there to change limits.
