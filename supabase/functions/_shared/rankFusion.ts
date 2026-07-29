// The Reciprocal Rank Fusion logic now lives in shared/ (SPEC-M5 FR-1.5) so
// the Electron main process fuses citation-engine channels with the exact
// same code this Deno function uses — see shared/search/rankFusion.ts for
// the algorithm and its rationale. Re-exported here so existing importers
// (citationEngine.ts, __tests__/rankFusion.test.ts) keep working unchanged.
export { RRF_K, reciprocalRankFusion, buildMatchKey } from "../../../shared/search/rankFusion.ts";
export type { FusableDoc, FusedDoc } from "../../../shared/search/rankFusion.ts";
