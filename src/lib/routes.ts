/**
 * Where "open this in the editor" should go.
 *
 * The editor became the workspace in M2. `/editor` lived on afterward as a
 * `VITE_WORKSPACE_SHELL=false` fallback to the old M1 page; that flag never
 * had a build that actually set it, so the fallback body was dead code and
 * both were retired (UX-v1 P3). `/editor` now survives only as a redirect for
 * bookmarks — call sites should still ask here rather than hardcode it, so a
 * future change to where the workspace lives has one place to update.
 */
export function editorRoute(documentId?: string): string {
  return documentId ? `/workspace/${documentId}` : "/workspace";
}
