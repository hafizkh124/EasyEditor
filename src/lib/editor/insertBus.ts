/**
 * External → editor insert bus (SPEC-TAFSIR §FR-5.3).
 *
 * The Tafsir search dialog lives on the Settings route while the TipTap editor
 * is on the Workspace route, so a dialog cannot reach the editor through props.
 * `RichEditor` registers the *current* editor's insert handler here; the Tafsir
 * dialog asks this bus to insert at the cursor. When no editor is mounted (or
 * the app is web-only), `tryExternalInsert` returns false and the caller falls
 * back to copying to the clipboard.
 */

let activeInsertHandler: ((html: string) => void) | null = null;

/** Called by the editor while it is mounted. Returns an unsubscribe fn. */
export function registerExternalInsertHandler(handler: (html: string) => void): () => void {
  activeInsertHandler = handler;
  return () => {
    if (activeInsertHandler === handler) activeInsertHandler = null;
  };
}

/** Attempts to insert HTML into the mounted editor. Returns success. */
export function tryExternalInsert(html: string): boolean {
  if (!activeInsertHandler) return false;
  try {
    activeInsertHandler(html);
    return true;
  } catch {
    return false;
  }
}
