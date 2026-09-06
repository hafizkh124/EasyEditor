/**
 * M8 Layer 6 — the claim-check tier for `insert_footnote` (SPEC-M8 §3
 * "Review gate", ADR-0019 item 6).
 *
 * ONE lightweight JSON call: does the retrieved excerpt actually support the
 * sentence the agent wants to footnote? Not a separate verifier agent — it
 * runs inside the one tool call, and a model/network failure is non-fatal
 * (degrades to "no opinion").
 *
 * M9 Phase C (ADR-0031): the implementation now lives in modelRouter.ts so it
 * follows the active provider (its fast `textModel`) instead of a hard-wired
 * Gemini endpoint. This file keeps the name the agent core imports.
 */
export { checkClaim } from './modelRouter.js';
