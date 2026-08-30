/**
 * M8 Layer 6 — the single-agent-task gate (SPEC-M8 §3, ADR-0019 item 6).
 *
 * COM automation is not safely re-entrant across simultaneous calls against
 * one Word `Application`, so only one agent task runs at a time. A second
 * request while one is in flight is REFUSED (not silently queued behind an
 * unbounded backlog) — the UI shows the running task and lets the user cancel
 * it. The refusal is explicit, matching the "visible queue, not a silent
 * restriction" requirement.
 */

interface RunningTask {
  id: string;
  startedAt: number;
  cancel: () => void;
}

let running: RunningTask | null = null;

export function isAgentBusy(): boolean {
  return running !== null;
}

export function runningTask(): { id: string; startedAt: number } | null {
  return running ? { id: running.id, startedAt: running.startedAt } : null;
}

/** Claim the single slot, or throw if it's taken. */
export function acquireAgentSlot(id: string, cancel: () => void): void {
  if (running) {
    throw new Error(`ایک ایجنٹ ٹاسک پہلے سے چل رہا ہے (${running.id}) — اسے مکمل ہونے دیں یا منسوخ کریں`);
  }
  running = { id, startedAt: Date.now(), cancel };
}

export function releaseAgentSlot(id: string): void {
  if (running?.id === id) running = null;
}

/** Cancel the in-flight task, if any. */
export function cancelRunningAgent(): boolean {
  if (!running) return false;
  running.cancel();
  return true;
}
