// AI call, not a data call: this orchestrator drives the `library-ingest` edge
// function, which embeds text. The AI adapter (M5.2) routes it through the
// right runtime.
import { callEdgeFunction, isDesktopEnv } from "@/core/ai/aiAdapter";
// Auth is cloud-only; desktop mode has no session model.
// eslint-disable-next-line no-restricted-imports
import { supabase } from "@/integrations/supabase/client";

export interface IngestProgress {
  itemId: string;
  inserted: number;
  totalChunks: number;
  progressPercent: number;
  done: boolean;
  status: "extracting" | "embedding" | "ready" | "failed" | "cancelled";
  error?: string;
}

export interface RunIngestArgs {
  itemId: string;
  /**
   * Where to pick up. A cancelled or interrupted ingest leaves its position in
   * `library_items.meta.ingest.next_offset`; passing it back skips work (and
   * embedding spend) that is already stored.
   */
  startOffset?: number;
  onProgress?: (progress: IngestProgress) => void;
  signal?: AbortSignal;
}

/**
 * Client-side orchestrator for resumable library ingest (SPEC-M4 FR-2.5).
 */
export async function runLibraryIngest({
  itemId,
  startOffset = 0,
  onProgress,
  signal,
}: RunIngestArgs): Promise<IngestProgress> {
  if (!isDesktopEnv()) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("سیشن مفقود ہے — برائے مہربانی دوبارہ سائن ان کریں۔");
  }

  let offset = startOffset;
  let done = false;
  let lastProgress: IngestProgress = {
    itemId,
    inserted: startOffset,
    totalChunks: 0,
    progressPercent: 0,
    done: false,
    status: startOffset > 0 ? "embedding" : "extracting",
  };

  onProgress?.(lastProgress);

  while (!done) {
    if (signal?.aborted) {
      // Not a failure: every chunk embedded so far is already committed, and
      // `meta.ingest.next_offset` is where a later run continues from.
      lastProgress = { ...lastProgress, status: "cancelled" };
      onProgress?.(lastProgress);
      break;
    }

    const res = await callEdgeFunction("library-ingest", {
      item_id: itemId, offset, batch_size: 100,
    });

    if (res.error) {
      console.error("[ingestOrchestrator] library-ingest error:", res.error);
      lastProgress.status = "failed";
      lastProgress.error = res.error.message || "Ingest failed";
      onProgress?.(lastProgress);
      throw new Error(`Ingest failed: ${res.error.message}`);
    }

    const data = res.data;
    offset = data.next_offset;
    done = data.done;

    lastProgress = {
      itemId,
      inserted: offset,
      totalChunks: data.total_chunks || 0,
      progressPercent: data.progress || (done ? 100 : 0),
      done,
      status: done ? "ready" : "embedding",
    };

    onProgress?.(lastProgress);
  }

  return lastProgress;
}
