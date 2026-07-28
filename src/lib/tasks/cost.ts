import type { TaskDefinition } from "./types";

/**
 * Calculate expected token cost for a task execution based on input character length.
 * Per SPEC-M2 & M3 token model: ~5 tokens per 2000 characters chunk.
 * Client-side tasks (e.g. remove_harakat) cost 0 tokens.
 */
export function calculateTaskCost(task: TaskDefinition, charLength: number): number {
  if (task.engine === "client") {
    return 0;
  }
  const base = task.costModel.baseTokens || 5;
  const chunkFactor = Math.max(1, Math.ceil(charLength / 2000));
  return base * chunkFactor;
}

export interface SolvencyCheckResult {
  isSolvent: boolean;
  requiredTokens: number;
  availableTokens: number;
  deficit: number;
}

/**
 * Check if the user has enough tokens to run the requested task.
 */
export function checkSolvency(requiredTokens: number, availableTokens: number): SolvencyCheckResult {
  const deficit = Math.max(0, requiredTokens - availableTokens);
  return {
    isSolvent: availableTokens >= requiredTokens,
    requiredTokens,
    availableTokens,
    deficit,
  };
}
