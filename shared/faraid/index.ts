/**
 * M12 Phase B — public surface of the from-scratch (Jumhūr) fara'id engine.
 * See `RULES.md`. Pure — the model never computes (ADR-0048).
 */
export { calculateFaraid, type FaraidInput, type FaraidResult, type FaraidLine } from './calculator.js';
export { HEIR_TYPES, HEIR_LABEL_UR, type HeirType, type HeirCounts } from './heirs.js';
export { computeFixedShares, type FixedSharesResult, type FixedShareLine } from './shares.js';
export { computeAsaba, type AsabaResult, type AsabaShare } from './asaba.js';
export { umariyyatan, musharaka, grandfatherWithSiblings, type OverrideLine } from './specialCases.js';
export * as rational from './rational.js';
