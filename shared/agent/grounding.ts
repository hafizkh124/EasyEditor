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

import { UNVERIFIED_DISCLAIMER_AR, type CitationVerifyStatus, type SourceLocus } from '../citation/verifyCitation.js';

/** A chunk the agent retrieved and may cite. */
export interface RetrievedChunk {
  /** Stable identity — `match_key`, or a synthesised id. */
  id: string;
  /** The verified, app-rendered reference line. */
  reference: string;
  source_url?: string | null;
  /** The excerpt text — used by the future claim-check tier. */
  content?: string;
  /**
   * A BIBLIOGRAPHIC reference to a WORK the agent has not read (Tier-2
   * repositories, M9 ADR-0028). `insert_footnote` accepts it only with NO
   * `claim` — it can name the work, never assert what a page of it says.
   */
  bibliographic?: boolean;
  /**
   * A hadith grading verdict AS THE SOURCE STATED IT (الدرر السنية, ADR-0040) —
   * never our own judgement. Shown as a distinct chip, not folded into the
   * reference line.
   */
  grade?: string;
  /**
   * The source's structured coordinates (book / volume / page / number / the
   * scholar behind `grade`), when the adapter has them — what `verifyCitation`
   * checks a claimed citation against. Absent ⇒ it matches against `reference`.
   */
  locus?: SourceLocus;
}

/** Accumulates every chunk the agent has retrieved so far in one task. */
export class RetrievalLedger {
  private readonly byId = new Map<string, RetrievedChunk>();
  /** Chunks a `verify_citation` call found wanting — insert_footnote refuses them. */
  private readonly failedVerification = new Map<string, CitationVerifyStatus>();

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

  /** Every chunk retrieved so far, in insertion order (M9 Phase E — the research subagent). */
  list(): RetrievedChunk[] {
    return [...this.byId.values()];
  }

  /** The retrieved chunk for an id, or undefined (no throw, no verification block). */
  get(id: string): RetrievedChunk | undefined {
    return this.byId.get(id);
  }

  /** Record a `verify_citation` verdict; a partial/unverified one blocks footnoting that source. */
  markVerification(id: string, status: CitationVerifyStatus): void {
    if (status === 'verified') this.failedVerification.delete(id);
    else this.failedVerification.set(id, status);
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
    const failed = this.failedVerification.get(sourceId);
    if (failed) {
      throw new Error(
        `insert_footnote: verify_citation found the claimed details for "${sourceId}" ${failed === 'partial' ? 'only partly' : 'not'} in the source — do not footnote them as claimed. Write: ${UNVERIFIED_DISCLAIMER_AR}`,
      );
    }
    return chunk;
  }

  /**
   * Attributed grading: a grade whose scholar the source did not name is not
   * printed in a footnote (the reference line is otherwise kept as retrieved).
   * Chunks with no `locus` are left untouched — their reference is the source's own line.
   */
  private withoutUnattributedGrade(chunk: RetrievedChunk): string {
    if (!chunk.grade || !chunk.locus || chunk.locus.gradedBy?.trim()) return chunk.reference;
    const g = chunk.grade;
    return chunk.reference
      .replace(`الحكم: ${g}`, '')
      .replace(`(${g})`, '')
      .replace(/\s*[—،]\s*(?=\(|$)/g, ' ')
      .replace(/\s{2,}/g, ' ');
  }

  /** The footnote body for a resolved chunk (URL appended when present). */
  footnoteText(chunk: RetrievedChunk): string {
    const ref = this.withoutUnattributedGrade(chunk).trim();
    return chunk.source_url ? `${ref} — ${chunk.source_url}` : ref;
  }
}

// ── the optional second tier: does the source support the claim? ──────────

export interface ClaimVerdict {
  /** true = the excerpt supports the claim; false = it does not. */
  supports: boolean;
  /** One short line for the transcript / the error the agent sees. */
  note: string;
}

/**
 * Injected — the real one is a single lightweight Gemini call
 * (electron/agent/claimCheck.ts); tests pass a fake. Not a separate
 * "verifier agent" (ADR-0019 rejected item 1) — one model call inside the
 * one tool.
 */
export type ClaimCheckFn = (claim: string, excerpt: string) => Promise<ClaimVerdict>;

/**
 * Run the claim check if a claim was given and a checker is available. A
 * missing claim or missing checker is NOT a failure — the deterministic
 * integrity gate (resolveOrThrow) has already run; this tier is optional.
 * Throws when the checker says the source does not support the claim.
 */
export async function assertClaimSupported(
  claim: unknown,
  excerpt: string | undefined,
  check: ClaimCheckFn | null,
): Promise<ClaimVerdict | null> {
  if (typeof claim !== 'string' || claim.trim() === '' || !check || !excerpt) return null;
  const verdict = await check(claim.trim(), excerpt);
  if (!verdict.supports) {
    throw new Error(`insert_footnote: the source does not support this claim — ${verdict.note}`);
  }
  return verdict;
}
