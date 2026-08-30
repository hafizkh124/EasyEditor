/**
 * M8 Layer 6 — the citation integrity gate (SPEC-M8 §3 "Review gate",
 * ADR-0016 control 3 / ADR-0019 item 6).
 *
 * `insert_footnote` may only use a source the agent actually RETRIEVED in
 * this task. The deterministic gate here: the `source_id` the model passes
 * must match a chunk returned by a prior `search_corpus` / `search_shamela`
 * call. An id that doesn't resolve gets an error — never an invented
 * footnote.
 *
 * The optional lightweight claim-check (does the excerpt support the
 * paragraph's claim) is a later P8 slice; this file is the cheap,
 * deterministic first tier.
 *
 * Pure — no runtime globals.
 */

/** A chunk the agent retrieved and may cite. */
export interface RetrievedChunk {
  /** Stable identity — `match_key`, or a synthesised id. */
  id: string;
  /** The verified, app-rendered reference line. */
  reference: string;
  source_url?: string | null;
  /** The excerpt text — used by the future claim-check tier. */
  content?: string;
}

/** Accumulates every chunk the agent has retrieved so far in one task. */
export class RetrievalLedger {
  private readonly byId = new Map<string, RetrievedChunk>();

  add(chunks: RetrievedChunk[]): void {
    for (const c of chunks) {
      if (c && typeof c.id === 'string' && c.id && typeof c.reference === 'string' && c.reference.trim()) {
        this.byId.set(c.id, c);
      }
    }
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * Resolve `sourceId` to a retrieved chunk, or throw a clear error the agent
   * loop feeds back to the model. This is the gate: no chunk ⇒ no footnote.
   */
  resolveOrThrow(sourceId: unknown): RetrievedChunk {
    if (typeof sourceId !== 'string' || sourceId.trim() === '') {
      throw new Error('insert_footnote: source_id is required and must be an id from a prior search_* result');
    }
    const chunk = this.byId.get(sourceId);
    if (!chunk) {
      throw new Error(
        this.size === 0
          ? 'insert_footnote: nothing has been retrieved yet — call search_corpus or search_shamela first'
          : `insert_footnote: "${sourceId}" is not one of the ${this.size} chunk id(s) retrieved in this task`,
      );
    }
    return chunk;
  }

  /** The footnote body for a resolved chunk (URL appended when present). */
  footnoteText(chunk: RetrievedChunk): string {
    const ref = chunk.reference.trim();
    return chunk.source_url ? `${ref} — ${chunk.source_url}` : ref;
  }
}
