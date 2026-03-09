

## EasyEditor — Implementation Plan

### 1. Enable Lovable Cloud
Set up Lovable Cloud for database, auth, edge functions, and secrets management.

### 2. Database Schema
- **profiles** table: `id` (FK to auth.users), `display_name`, `avatar_url`, `preferred_language` (default 'en'), `created_at`, `updated_at`
- **user_roles** table with `app_role` enum (`admin`, `user`)
- **subscriptions** table: `id`, `user_id` (FK), `tier` (enum: `free`, `pro`), `transcription_seconds_used`, `transcription_limit` (e.g. 300 for free, unlimited for pro), `created_at`, `updated_at`
- Auto-create profile + free subscription on signup via DB trigger
- RLS policies so users can only read/update their own data

### 3. Authentication
- Email/password sign-up & login
- Google OAuth button (code ready, user configures Google provider later)
- Password reset flow with `/reset-password` page
- Auth state management with protected routes
- Auto-redirect to dashboard after login

### 4. UI Shell — Mobile-First + RTL
- **Mobile**: Bottom navigation bar (Home, Transcribe, Settings)
- **Desktop**: Collapsible sidebar with the same navigation
- RTL support via `dir` attribute and Tailwind logical properties, toggled by language selection
- Clean, minimalist design with shadcn/ui components
- Language context provider managing `dir`, locale, and UI strings

### 5. Pages
- **Login / Sign Up** — auth forms with Google button
- **Dashboard** — welcome screen, usage stats, quick access to tools
- **Speech-to-Text** — the main functional module
- **Settings** — profile editing, language preference, subscription status display
- **Reset Password** — for email reset flow

### 6. Speech-to-Text Module
- Mic button to start/stop recording using browser `MediaRecorder` API
- Audio sent to an Edge Function that calls Lovable AI Gateway for transcription/refinement
- Language toggle (Urdu `ur-PK` / English `en-US`) that flips layout RTL/LTR
- Live transcript display area with copy/download options
- Usage tracking: increment `transcription_seconds_used` in subscriptions table; block free users at limit with upgrade prompt

### 7. Edge Function: `transcribe`
- Receives audio or raw text from browser
- Calls Lovable AI Gateway to process/refine transcription
- Returns cleaned text
- Checks user subscription tier and enforces limits

### 8. Roadmap Placeholder
- Dashboard cards for upcoming tools (AI Research Assistant, OCR, TTS) marked as "Coming Soon"

