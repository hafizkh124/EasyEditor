// AUTO-MIRRORED from shared/ai/embedConstants.ts — edge deploy bundles only supabase/functions/.
// Edit shared/ai/embedConstants.ts and re-run: npm run mirror:shared (scripts/mirror-shared.mjs).
// Canonical embedding model + dimensionality — THE single source of truth.
//
// Every embedding call, in every runtime, must use these values:
//   - Deno edge functions  → supabase/functions/_shared/embed.ts
//   - Electron main (Node) → electron/db/ingest.ts (M5.3)
//
// WHY THIS FILE EXISTS: a query embedded with a different model lands in a
// different vector space than the stored vectors. Cosine similarity then
// becomes meaningless and every search silently returns zero results — no
// error, just empty. That exact bug already happened once: refine-text and
// ingest-scholarly-data called the retired "text-embedding-004" while every
// working search path called "gemini-embedding-001". See the comment at the
// top of supabase/functions/_shared/embed.ts for the full history.
//
// Changing either value means re-embedding every corpus that exists —
// scholarly_documents, every user's library_chunks, and every local SQLite
// corpus on a user's machine. Treat them as immutable.

export const EMBED_MODEL = "gemini-embedding-001";
export const EMBED_DIMS = 768;
