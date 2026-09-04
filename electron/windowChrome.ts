/**
 * M9 Phase 1b — the Windows caption-button overlay, matched to the app's own
 * palette instead of a hardcoded colour (which was the "black box in the
 * corner" bug: wrong in light mode, and not even the right dark).
 *
 * src/index.css: light `--background 0 0% 96%` / `--foreground 0 0% 9%`; dark is
 * the inverse. Kept in its own module so `main.ts` and `ipc/systemHandlers.ts`
 * can both reach it without a circular import.
 */
import { nativeTheme, type BrowserWindow } from 'electron';

let win: BrowserWindow | null = null;

export function setChromeWindow(w: BrowserWindow | null): void {
  win = w;
}

export function overlayColors(dark: boolean): { color: string; symbolColor: string } {
  return dark
    ? { color: '#171717', symbolColor: '#fafafa' }
    : { color: '#f5f5f5', symbolColor: '#171717' };
}

/**
 * Push the current overlay to the window. `theme` is the renderer's resolved
 * light/dark (it can differ from the OS when the user overrides it in-app);
 * omit it to follow `nativeTheme`. Safe before the window is shown, and a
 * no-op off Windows / on a non-hidden-titlebar window.
 */
export function refreshTitleBarOverlay(theme?: 'light' | 'dark'): void {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const dark = theme ? theme === 'dark' : nativeTheme.shouldUseDarkColors;
  try {
    win.setTitleBarOverlay({ ...overlayColors(dark), height: 36 });
  } catch { /* not a hidden-titlebar window */ }
}
