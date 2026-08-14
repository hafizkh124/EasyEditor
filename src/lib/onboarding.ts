/**
 * First-run hints — small, dismissible, persisted once. Same shape as
 * `hasChosenLanguage`/`persistLanguage` in `lib/i18n.ts` and
 * `applyInitialAppTheme` in `lib/theme.ts`: a plain localStorage flag guarded
 * against privacy-mode failures, no backend round-trip.
 *
 * UX-v1 P6 — explicitly a hint, not a tour: one dismissible callout, shown
 * once, gone for good once the user has done the thing it points at.
 */
const WORKSPACE_HINT_STORAGE_KEY = "easyeditor-workspace-hint-dismissed";

export function hasSeenWorkspaceHint(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(WORKSPACE_HINT_STORAGE_KEY) === "1";
  } catch {
    // Privacy mode: treat as already seen rather than show a hint that can
    // never actually be dismissed for this user.
    return true;
  }
}

export function dismissWorkspaceHint(): void {
  try {
    window.localStorage.setItem(WORKSPACE_HINT_STORAGE_KEY, "1");
  } catch {
    // Non-fatal — worst case the hint reappears next session.
  }
}
