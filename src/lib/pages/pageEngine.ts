import { useCallback, useEffect, useState } from "react";
import { isDesktop } from "@/utils/environment";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Which engine reads (OCR) and translates pages here (SYSTEM-2026 §10):
 *
 * - "own-key": the desktop with the user's own Gemini key — runs in the main
 *   process (electron/ipc/aiHandlers.ts), no account and no tokens.
 * - "account": the signed-in account's cloud functions, paid in tokens (the
 *   web always; the desktop when signed in without a key).
 * - null: neither — the feature is still there, showing how to enable it.
 *
 * The own key wins on the desktop: it costs the user nothing extra.
 */
export type PageEngine = "own-key" | "account" | null;

async function hasOwnGeminiKey(): Promise<boolean> {
  try {
    const status = await window.electronAPI?.byok?.getKeyStatus("gemini");
    return Boolean(status?.hasKey);
  } catch {
    return false;
  }
}

/** Whether this page should run on the desktop's own key — asked per call, so a key added a moment ago counts. */
export async function usesOwnKey(): Promise<boolean> {
  return isDesktop() && hasOwnGeminiKey();
}

/** The page engine, kept current: re-checked on sign-in/out and when the window regains focus (a key added in Settings). */
export function usePageEngine(): { engine: PageEngine; loading: boolean; refresh: () => void } {
  const { user } = useAuth();
  const [engine, setEngine] = useState<PageEngine>(isDesktop() ? null : user ? "account" : null);
  const [loading, setLoading] = useState(isDesktop());
  const refresh = useCallback(() => {
    if (!isDesktop()) {
      setEngine(user ? "account" : null);
      setLoading(false);
      return;
    }
    void hasOwnGeminiKey().then((own) => {
      setEngine(own ? "own-key" : user ? "account" : null);
      setLoading(false);
    });
  }, [user]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return { engine, loading, refresh };
}
