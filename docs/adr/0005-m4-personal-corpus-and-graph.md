# 0005: M4 Personal Corpus, Knowledge Graph, and Recipes Architecture

**Status:** Accepted  
**Date:** 2026-07-28  
**Branch:** `newee`  

---

## Context & Problem Statement

EasyEditor 2.0 previously grounded AI assistance in a shared classical corpus (`scholarly_documents`). Users needed the ability to search, cite, and synthesize across their own personal books (PDF, DOCX, TXT, MD), construct a persistent Knowledge Graph of scholars, concepts, and commentaries, and execute multi-step automated scholarly workflows (Recipes).

---

## Decision Drivers

1. **User Privacy & RLS Enforcement**: Personal library chunks and knowledge graphs must never leak across users.
2. **Double-Hybrid Retrieval**: Querying scripture and personal documents simultaneously using 4-way Reciprocal Rank Fusion ($K=60$).
3. **Resumable Ingest & Solvency**: Large documents must ingest in resumable batches without hitting Edge Function memory or execution limits, with upfront token cost transparency.

---

## Architectural Decisions

### 1. Storage & Database Schema
- Created private Supabase storage bucket `library-files` with owner-only RLS (`{user_id}/{item_id}.ext`).
- Created `library_chunks` table storing 768-dim embeddings (`gemini-embedding-001`).
- Created `match_library_chunks` RPC configured strictly as `STABLE SECURITY INVOKER` to guarantee user-level RLS isolation.

### 2. Double-Hybrid RRF Retrieval
- Updated `citationEngine.ts` to merge 4 distinct channels in parallel:
  1. Scholarly Vector (`match_scholarly_documents`)
  2. Scholarly Full-Text (`search_documents_scoped`)
  3. Personal Corpus Vector (`match_library_chunks`)
  4. Personal Corpus Full-Text (`library_chunks` text search)
- Deduplicated results via Reciprocal Rank Fusion ($K=60$).

### 3. Knowledge Graph
- Created `entities` (person, concept, book, location, event) and `entity_relations` tables.
- Implemented `graph-extract` Edge Function using Gemini 2.5 Flash to extract entities, relations, and evidence quotes.
- Built interactive `KnowledgeGraphTab` with backlinks linking entities back to parent documents and library items.

### 4. Recipes & Pre-flight Solvency
- Created `recipes` table pre-seeded with 3 built-in scholarly pipelines.
- Implemented `calculateRecipeCost` and `SourceUploadDialog` providing pre-flight solvency checks prior to network requests.

---

## Consequences

- **Positives**: Complete isolation of personal data, unified citation pipeline across classical scripture and personal research, upfront cost transparency.
- **Verification**: `npm run typecheck` passes with 0 errors; all 162 unit tests pass cleanly across 25 test files.
