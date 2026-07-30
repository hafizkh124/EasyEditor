# ADR 0006 — Workspace Backend Adapter Architecture

**Status:** Accepted · **Date:** 2026-07-29 · **Milestone:** M5.0

## Context

Milestone M5 requires Al-Ulama Easy Editor to run in two distinct operational environments:
1. **Web Mode:** Cloud-backed using Supabase Postgres, pgvector, and Deno edge functions.
2. **Desktop Mode:** 100% offline using local SQLite (`better-sqlite3`), `sqlite-vec`, and direct Gemini API calls via IPC.

The requirement was to maintain a single codebase without code duplication, parallel component implementations, or leaky `if (isElectron)` conditionals inside UI code.

## Decision

We implemented a unified **Facade Adapter Pattern** under `src/core/backend/`:

- `types.ts` defines the authoritative `WorkspaceBackend` TypeScript interface.
- `cloudBackend.ts` implements `WorkspaceBackend` wrapping existing Supabase RPC/REST API calls.
- `localBackend.ts` implements `WorkspaceBackend` proxying requests via secure Electron IPC (`workspace:invoke`) to the main process `WorkspaceDbService`.
- `index.ts` provides a runtime factory `getBackend()` that resolves the appropriate implementation cleanly based on environment detection.

## Consequences

- The entire React UI (`pages/`, `components/`) calls `getBackend()` and remains completely agnostic of the underlying database engine.
- Web mode functionality remains 100% regression-free.
- Architecture enforcement is backed by automated ESLint rules.
