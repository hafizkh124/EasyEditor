/**
 * SPEC-UIUX F2 — localStorage persistence for the Home first-run hint.
 * Same `APP_*_STORAGE_KEY` pattern as theme.ts; lives outside the component
 * so react-refresh keeps the component file component-only.
 */
export const APP_FIRSTRUN_HINT_KEY = "easyeditor-firstrun-hint";

export function isFirstRunHintDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(APP_FIRSTRUN_HINT_KEY) === "dismissed";
  } catch {
    return true;
  }
}

export function dismissFirstRunHint(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_FIRSTRUN_HINT_KEY, "dismissed");
  } catch {
    /* privacy mode — nothing to persist */
  }
}