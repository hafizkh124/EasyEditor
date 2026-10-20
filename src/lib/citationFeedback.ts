import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { CitationVerifyStatus } from "~shared/citation/verifyCitation";

/**
 * Golden-dataset feedback on AI citations: the scholar approves a citation
 * as-is, or corrects it. Rows are owner-only (RLS) and carry
 * `consent_training = false` unless the scholar opts in elsewhere.
 *
 * Same shape as `activityLog.ts`: a Supabase insert when signed in, otherwise
 * (or if the table is not migrated yet) a capped localStorage queue that
 * `flushQueuedFeedback` drains on a later session.
 */

export interface CitationSnapshot {
  reference: string;
  grade?: string;
  gradedBy?: string;
  sourceUrl?: string;
}

export interface CitationFeedback {
  action: "approve" | "correct";
  sourceId?: string;
  verifyStatus?: CitationVerifyStatus;
  original: CitationSnapshot;
  /** Required for `correct`. */
  corrected?: CitationSnapshot;
}

const QUEUE_KEY = "easyeditor-citation-feedback-queue";
const MAX_QUEUED = 50;

function readQueue(): CitationFeedback[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(items: CitationFeedback[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUED)));
  } catch {
    // storage unavailable — the feedback is simply not retained offline
  }
}

async function insertRow(userId: string, f: CitationFeedback): Promise<boolean> {
  const { error } = await supabase.from("citation_feedback").insert({
    user_id: userId,
    action: f.action,
    source_id: f.sourceId ?? null,
    verify_status: f.verifyStatus ?? null,
    original: f.original as unknown as Json,
    corrected: (f.corrected ?? null) as unknown as Json,
  });
  return !error;
}

/** Record one approve/correct. Resolves `"saved"` or `"queued"` (offline / not migrated). */
export async function submitCitationFeedback(f: CitationFeedback): Promise<"saved" | "queued"> {
  if (f.action === "correct" && !f.corrected) throw new Error("a correction needs the corrected citation");
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user && (await insertRow(session.user.id, f))) return "saved";
  } catch {
    // fall through to the queue
  }
  writeQueue([...readQueue(), f]);
  return "queued";
}

/** Drain the offline queue into Supabase; whatever still fails stays queued. */
export async function flushQueuedFeedback(): Promise<number> {
  const queue = readQueue();
  if (queue.length === 0) return 0;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return 0;
    const remaining: CitationFeedback[] = [];
    for (const item of queue) {
      if (!(await insertRow(session.user.id, item))) remaining.push(item);
    }
    writeQueue(remaining);
    return queue.length - remaining.length;
  } catch {
    return 0;
  }
}
