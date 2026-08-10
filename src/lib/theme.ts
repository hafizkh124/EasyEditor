export const APP_THEME_STORAGE_KEY = "easyeditor-theme";

export type AppTheme = "light" | "dark" | "system";

export function isAppTheme(value: unknown): value is AppTheme {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Set the initial class before React mounts so web, PWA and Electron do not
 * flash the light palette while the saved/system theme is being resolved.
 */
export function applyInitialAppTheme(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  let selected: AppTheme = "system";
  try {
    const stored = window.localStorage.getItem(APP_THEME_STORAGE_KEY);
    if (isAppTheme(stored)) selected = stored;
  } catch {
    // Privacy mode can make localStorage unavailable; system remains safe.
  }

  const resolved = selected === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : selected;

  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
}
