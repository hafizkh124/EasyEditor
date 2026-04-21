# Scribe Studio

An AI-powered content toolkit supporting **English and Urdu**, featuring:

- **Transcribe** — Speech-to-text with AI refinement (formalize, humanize, shorten, citations)
- **Speak** — Text-to-speech with 6 voice personas powered by Google Gemini
- **OCR** — Image-to-text extraction with Urdu/Arabic support
- **Research** — AI research assistant with URL, PDF, and DOCX source grounding

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

**Security:** `.env` is gitignored and must never be committed. The app will fail to
start if any of the three required `VITE_SUPABASE_*` variables are missing.

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

Tables created:
- `profiles` — User profile data
- `subscriptions` — Tier and usage tracking (free/pro)
- `user_roles` — Role-based access control
- `research_sources` — Saved research documents

## Subscription Tiers

| Feature | Free | Pro |
|---------|------|-----|
| Transcription | 300 seconds/month | Unlimited |
| Text-to-Speech | 2,000 characters/month | Unlimited |
| OCR | Shared transcription budget | Unlimited |
| Research | Unlimited | Unlimited |
