/**
 * Environment detection utilities.
 */

export function isDesktop(): boolean {
  return (
    import.meta.env.VITE_DESKTOP === "true" ||
    (typeof window !== "undefined" && Boolean((window as unknown as { electronAPI?: { isDesktop?: boolean } }).electronAPI?.isDesktop))
  );
}

/**
 * Whether this machine uses ⌘ rather than Ctrl for shortcuts.
 *
 * Only for *labels* — the handlers themselves accept `metaKey || ctrlKey`
 * everywhere and must keep doing so, since an external keyboard can send
 * either. `userAgentData.platform` is the non-deprecated source; `platform` is
 * the fallback still needed for Safari and Firefox.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform;
  const platform = uaPlatform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The Cmd/Ctrl modifier as it should be *shown* to this user. */
export function modifierKeyLabel(): string {
  return isMacPlatform() ? "⌘" : "Ctrl+";
}
