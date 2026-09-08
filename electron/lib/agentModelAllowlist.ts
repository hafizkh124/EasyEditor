/**
 * M9 Phase C (ADR-0031) — thin re-export.
 *
 * The real allowlist moved to shared/ai/modelAllowlist.ts in M10 Phase 2.5.1
 * so the web BYOK path (the agent-model edge function) can enforce the exact
 * same host list. This file exists only so electron/ai/openAiCompatibleClient.ts
 * and its tests keep importing from the same path they always have.
 */
export { assertAllowedModelUrl, isAllowedModelHost } from '../../shared/ai/modelAllowlist.js';
