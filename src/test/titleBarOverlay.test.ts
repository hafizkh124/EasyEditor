// @vitest-environment node
// electron/windowChrome.ts (M9 Phase 1b). The Windows caption-button overlay
// must match the app palette, not a hardcoded colour — the "black box in the
// corner" bug was `#1e1e2e` (Catppuccin dark) hardcoded, wrong in light mode.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const setTitleBarOverlay = vi.fn();
const fakeWin = { isDestroyed: () => false, setTitleBarOverlay };

vi.mock('electron', () => ({ nativeTheme: { shouldUseDarkColors: false } }));

let mod: typeof import('../../electron/windowChrome');
let realPlatform: PropertyDescriptor | undefined;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  mod = await import('../../electron/windowChrome');
});
afterEach(() => {
  if (realPlatform) Object.defineProperty(process, 'platform', realPlatform);
});

describe('overlayColors', () => {
  it('light = light ground + dark symbols; dark = the inverse', () => {
    expect(mod.overlayColors(false)).toEqual({ color: '#f5f5f5', symbolColor: '#171717' });
    expect(mod.overlayColors(true)).toEqual({ color: '#171717', symbolColor: '#fafafa' });
  });

  it('is never the old hardcoded Catppuccin value', () => {
    expect(mod.overlayColors(true).color).not.toBe('#1e1e2e');
    expect(mod.overlayColors(false).color).not.toBe('#1e1e2e');
  });
});

describe('refreshTitleBarOverlay', () => {
  it('pushes the renderer-resolved theme when given one', () => {
    mod.setChromeWindow(fakeWin as never);
    mod.refreshTitleBarOverlay('dark');
    expect(setTitleBarOverlay).toHaveBeenCalledWith(expect.objectContaining({ color: '#171717', height: 36 }));
  });

  it('is a no-op with no window set', () => {
    mod.setChromeWindow(null);
    mod.refreshTitleBarOverlay('light');
    expect(setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
