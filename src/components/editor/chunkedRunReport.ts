import { toast } from "sonner";
import type { ChunkedRunResult } from "@/lib/tasks/chunkOrchestrator";
import type { LastRunSummary } from "@/components/workspace/TaskRunCard";

/**
 * How a finished chunked run is reported to the user.
 *
 * Kept out of the hook so `useChunkedRuns` stays under the 300-line limit
 * (SPEC-M3 NFR-1), and because none of it needs React state — it is a pure
 * function of the result plus one toast.
 */
export function describeRunResult(result: ChunkedRunResult, totalBatches: number): string {
  const parts = [`${result.applied} از ${totalBatches} حصے مکمل`];
  if (result.failed > 0) parts.push(`${result.failed} ناکام`);
  if (result.invalidated > 0) parts.push(`${result.invalidated} حذف شدہ`);
  if (result.skipped > 0) parts.push(`${result.skipped} بلاک محفوظ رکھے گئے`);
  return parts.join("، ");
}

/** Announce the outcome. A cancelled run says so — it is not a success. */
export function announceRunResult(result: ChunkedRunResult, summary: string): void {
  if (result.cancelled) {
    toast.info(`منسوخ — ${summary}۔ مکمل شدہ حصے محفوظ ہیں۔`);
  } else if (result.applied === 0) {
    toast.error("کوئی حصہ مکمل نہ ہو سکا۔");
  } else {
    toast.success(summary);
  }
}

export function toLastRunSummary(
  result: ChunkedRunResult,
  taskLabel: string,
  totalBatches: number,
): LastRunSummary {
  return {
    runId: result.runId,
    taskLabel,
    applied: result.applied,
    total: totalBatches,
    failed: result.failed,
    skipped: result.skipped,
    invalidated: result.invalidated,
    tokensSpent: result.tokensSpent,
    sources: result.sources,
    confidence: result.confidence,
    cancelled: result.cancelled,
  };
}
