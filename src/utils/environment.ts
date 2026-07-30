/**
 * Environment detection utilities.
 */

export function isDesktop(): boolean {
  return (
    import.meta.env.VITE_DESKTOP === "true" ||
    (typeof window !== "undefined" && Boolean((window as unknown as { electronAPI?: { isDesktop?: boolean } }).electronAPI?.isDesktop))
  );
}
