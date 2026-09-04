import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * M9 Phase 1b — keep the Windows caption-button overlay in step with the app's
 * resolved theme. next-themes can override the OS (the user picks Light while
 * Windows is Dark), and `nativeTheme` on the main side only sees the OS — so the
 * renderer pushes its own `resolvedTheme`. Renders nothing; desktop-only.
 */
export default function DesktopTitleBarSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const api = (window as unknown as {
      electronAPI?: { isDesktop?: boolean; setTheme?: (t: "light" | "dark") => Promise<void> };
    }).electronAPI;
    if (!api?.isDesktop || !api.setTheme) return;
    const t = resolvedTheme === "dark" ? "dark" : "light";
    void api.setTheme(t);
  }, [resolvedTheme]);

  return null;
}
