/**
 * Where "open this in the editor" should go.
 *
 * The editor became the workspace in M2, but `/editor` stayed alive as a
 * redirect so `VITE_WORKSPACE_SHELL=false` can still fall back to the M1
 * page. Call sites must not hardcode either path: pointing them all at
 * `/editor` sends every handoff through a redirect, and hardcoding
 * `/workspace` breaks the flag-off fallback. Ask here instead.
 */
export function isWorkspaceShellEnabled(): boolean {
  return import.meta.env.VITE_WORKSPACE_SHELL !== "false";
}

export function editorRoute(documentId?: string): string {
  const base = isWorkspaceShellEnabled() ? "/workspace" : "/editor";
  return documentId ? `${base}/${documentId}` : base;
}
