# Scribe Studio

An AI-powered content toolkit supporting **English and Urdu**, featuring:

- **Transcribe** — Speech-to-text with AI refinement (formalize, humanize, shorten, citations). Supports long-form audio up to 60 minutes via client-side chunked transcription.
- **Speak** — Text-to-speech with 6 voice personas powered by Google Gemini
- **OCR** — Image-to-text extraction with Urdu/Arabic support
- **Research** — Three-mode AI research assistant (Islamic / Custom Sources / General) with optional spelling correction and citation overlays
- **Session history** — Per-section session list in the sidebar; sessions persist unlimited across reloads.

See [`docs/SPEC-v2.md`](docs/SPEC-v2.md) for the full v2 specification and
[`docs/adr/`](docs/adr/) for architectural decision records.

## Tech Stack

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions, Storage)
- **AI:** Google Gemini 2.5 Flash, Lovable AI Gateway, ElevenLabs

## Getting Started

### Prerequisites

- Node.js 18+ or Bun
- A [Supabase](https://supabase.com) project
- Google Gemini API key
- Lovable AI Gateway key

### Installation

```sh
# 1. Clone the repository
git clone <YOUR_GIT_URL>
cd scribe-studio-app

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env and fill in your actual values

# 4. Start the development server
npm run dev
```

The app will be available at `http://localhost:8080`.

### Environment Variables

**Security:** `.env` is gitignored and must never be committed. There are no
hardcoded fallbacks for Supabase credentials — `vite build --mode production`
fails fast if any of the three required `VITE_SUPABASE_*` variables are missing.

Copy `.env.example` to `.env` and provide:

```
VITE_SUPABASE_PROJECT_ID=your-supabase-project-id
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-key
VITE_SUPABASE_URL=https://your-project-id.supabase.co
```

Supabase Edge Functions read their secrets from the Supabase project, **not** from
`.env`. Set them via the Supabase dashboard or CLI:

```sh
supabase secrets set \
  SUPABASE_SERVICE_ROLE_KEY=... \
  LOVABLE_API_KEY=... \
  GEMINI_API_KEY=... \
  INGEST_SHARED_SECRET=...
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (port 8080) |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run test` | Run unit tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint source files |

## Database Setup

Run Supabase migrations to set up the database schema:

```sh
npx supabase db push
```

Tables created (selected):
- `profiles` — User profile data
- `subscriptions` — Tier and usage tracking
- `user_roles` — Role-based access control
- `research_sources` — Saved research documents
- `user_sessions` — Per-section persisted session history (transcribe / speak / ocr / research)

## Subscription Tiers

Four tiers: **free** (no access), **basic**, **pro**, **ultra**. Per-tier quota
columns live on the `subscriptions` table; canonical values are defined in
[`src/contexts/SubscriptionContext.tsx`](src/contexts/SubscriptionContext.tsx)
under `TIER_LIMITS`. Edit there to change limits.
