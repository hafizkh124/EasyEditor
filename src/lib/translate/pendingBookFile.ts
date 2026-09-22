/**
 * Read-once handoff for a File object between Quick Translate's PDF button
 * and the `/translate-book` page.
 *
 * Every other in-app handoff (`Workspace.tsx`'s `WorkspaceHandoffState`) passes
 * a plain string through router `location.state`, which survives serialization
 * and a reload cleanly. A `File` is a live browser object — it cannot round-trip
 * through history state reliably (and does not survive a reload at all) — so it
 * is handed over via this module-level variable instead: set right before
 * `navigate()`, read (and cleared) once the destination page mounts. A reload
 * or a direct link to `/translate-book` simply finds nothing here and falls
 * back to its own upload prompt.
 */

let pendingFile: File | null = null;

export function setPendingBookFile(file: File): void {
  pendingFile = file;
}

/** Returns the pending file, if any, and clears it — safe to call only once per navigation. */
export function takePendingBookFile(): File | null {
  const file = pendingFile;
  pendingFile = null;
  return file;
}
