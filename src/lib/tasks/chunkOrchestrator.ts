import { getTaskBySlug } from "./registry";
import { calculateTaskCost } from "./cost";
import { taskRunService } from "@/core/workspace/taskRunService";
import { callRefineTextDetailed, isRefineTextAction } from "@/lib/editor/aiActions";
import type { TextBatch } from "@/lib/editor/docChunker";
import type { TaskRunSource } from "@/core/workspace/types";
import type { ChunkProgress } from "./types";

/**
 * Client-side chunked-run orchestration (SPEC-M3 FR-5.3–FR-5.7), shaped after
 * `src/lib/audio/transcribeLongForm.ts` per ADR 0001.
 */

export class ChunkedTaskCancelledError extends Error {
  constructor() {
    super("ٹاسک کا عمل منسوخ کر دیا گیا");
    this.name = "ChunkedTaskCancelledError";
  }
}

/**
 * `refine-text` allows 30 requests/user/minute. Dispatching a 30-batch run as
 * fast as the network allows guarantees a 429 partway through and leaves the
 * scholar with a half-processed document, so batches are paced to ~25/min.
 * A slow run with a progress bar and a cancel button is the intended trade.
 */
export const THROTTLE_MS = 2400;

export interface ChunkedRunProgress extends ChunkProgress {
  phase: "preparing" | "running" | "finalizing";
  current: number;
  tokensSpent: number;
  throttled: boolean;
}

export interface RunChunkedTaskArgs {
  taskSlug: string;
  batches: TextBatch[];
  accessToken: string;
  projectId?: string;
  documentId?: string;
  /** Real wallet balance. The run stops gracefully when it would go negative. */
  availableTokens?: number;
  skipped?: number;
  signal?: AbortSignal;
  onProgress?: (progress: ChunkedRunProgress) => void;
  /**
   * Write one batch's result into the document, immediately.
   *
   * Applying per batch (rather than assembling and writing once at the end) is
   * what makes cancellation safe: everything already applied stays, and the
   * editor's own autosave persists it with no extra code.
   * Return false when the range is gone and the result was dropped.
   */
  applyBatch: (batchIndex: number, result: string) => boolean;
}

export interface ChunkedRunResult {
  runId?: string;
  applied: number;
  failed: number;
  skipped: number;
  invalidated: number;
  tokensSpent: number;
  sources: TaskRunSource[];
  confidence: number | null;
  cancelled: boolean;
  partial: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runChunkedTask({
  taskSlug,
  batches,
  accessToken,
  projectId,
  documentId,
  availableTokens,
  skipped = 0,
  signal,
  onProgress,
  applyBatch,
}: RunChunkedTaskArgs): Promise<ChunkedRunResult> {
  const task = getTaskBySlug(taskSlug);
  if (!task) throw new Error(`ٹاسک '${taskSlug}' دستیاب نہیں ہے۔`);
  if (!task.actionName || !isRefineTextAction(task.actionName)) {
    throw new Error(`ٹاسک ایکشن '${task.actionName}' مفقود یا باطل ہے۔`);
  }
  const action = task.actionName;

  const progress: ChunkedRunProgress = {
    phase: "preparing",
    total: batches.length,
    current: 0,
    done: 0,
    failed: 0,
    skipped,
    tokensSpent: 0,
    throttled: false,
  };
  onProgress?.({ ...progress });

  const run = await taskRunService.createTaskRun({
    projectId,
    documentId,
    taskSlug: task.slug,
    input: {
      totalBatches: batches.length,
      chars: batches.reduce((sum, b) => sum + b.charCount, 0),
      estimatedCost: batches.reduce((sum, b) => sum + calculateTaskCost(task, b.charCount), 0),
      skippedBlocks: skipped,
    },
  });

  const allSources: TaskRunSource[] = [];
  const confidences: number[] = [];
  let invalidated = 0;
  let cancelled = false;
  // Local ledger: the server debits per request, so the client must track what
  // it has already spent or it will keep firing after the wallet is empty.
  let remainingTokens = availableTokens;
  let lastDispatch = 0;

  progress.phase = "running";

  try {
    for (const batch of batches) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }

      const cost = calculateTaskCost(task, batch.charCount);
      if (typeof remainingTokens === "number" && remainingTokens < cost) {
        // Stop gracefully rather than burning through 402s: everything applied
        // so far stays in the document (FR-5.5).
        break;
      }

      const wait = THROTTLE_MS - (Date.now() - lastDispatch);
      if (lastDispatch > 0 && wait > 0) {
        progress.throttled = true;
        onProgress?.({ ...progress });
        await sleep(wait);
        if (signal?.aborted) {
          cancelled = true;
          break;
        }
      }
      progress.throttled = false;
      progress.current = batch.index + 1;
      onProgress?.({ ...progress });

      lastDispatch = Date.now();
      let result: Awaited<ReturnType<typeof callRefineTextDetailed>> | null = null;

      try {
        result = await callRefineTextDetailed(batch.text, action, accessToken);
      } catch (err) {
        // One retry after a rate-limit window; anything else fails this batch
        // only — a document with 23 of 25 paragraphs done is still useful,
        // unlike a transcript with a hole in it (FR-5.7).
        const isRateLimit = err instanceof Error && /429|rate limit/i.test(err.message);
        if (isRateLimit && !signal?.aborted) {
          progress.throttled = true;
          onProgress?.({ ...progress });
          await sleep(THROTTLE_MS * 5);
          try {
            result = await callRefineTextDetailed(batch.text, action, accessToken);
          } catch {
            result = null;
          }
        }
      }

      if (!result || !result.text) {
        progress.failed++;
      } else {
        const applied = applyBatch(batch.index, result.text);
        if (applied) {
          progress.done++;
        } else {
          invalidated++;
        }
        const spent = result.tokensUsed ?? cost;
        progress.tokensSpent += spent;
        if (typeof remainingTokens === "number") remainingTokens -= spent;
        if (result.sources?.length) allSources.push(...result.sources);
        if (typeof result.confidence === "number") confidences.push(result.confidence);
      }

      if (run?.id) {
        await taskRunService.updateTaskRun(run.id, {
          progress: {
            total: progress.total,
            done: progress.done,
            failed: progress.failed,
            skipped: progress.skipped,
          },
          tokensSpent: progress.tokensSpent,
        });
      }
      onProgress?.({ ...progress });
    }

    progress.phase = "finalizing";
    onProgress?.({ ...progress });

    const partial = progress.failed > 0 || invalidated > 0 || cancelled;
    const status = cancelled ? "cancelled" : progress.done === 0 ? "failed" : "completed";

    if (run?.id) {
      await taskRunService.updateTaskRun(run.id, {
        status,
        output: { partial, invalidated },
        sources: allSources,
        // The weakest batch is the one that will embarrass the scholar, so the
        // run reports the minimum rather than the mean (FR-4.3).
        confidence:
          task.producesSources && confidences.length > 0 ? Math.min(...confidences) : undefined,
        tokensSpent: progress.tokensSpent,
        progress: {
          total: progress.total,
          done: progress.done,
          failed: progress.failed,
          skipped: progress.skipped,
        },
      });
    }

    return {
      runId: run?.id,
      applied: progress.done,
      failed: progress.failed,
      skipped: progress.skipped,
      invalidated,
      tokensSpent: progress.tokensSpent,
      sources: allSources,
      confidence: confidences.length > 0 ? Math.min(...confidences) : null,
      cancelled,
      partial,
    };
  } catch (err) {
    if (run?.id) {
      await taskRunService.updateTaskRun(run.id, {
        status: "failed",
        error: err instanceof Error ? err.message : "Execution failed",
        tokensSpent: progress.tokensSpent,
      });
    }
    throw err;
  }
}
