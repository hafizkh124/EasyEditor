import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { SessionSection } from "@/hooks/useSessionHistory";
import { loadUserSession, upsertUserSession } from "@/lib/userSessions";

interface UsePageSessionArgs<M extends Record<string, unknown>> {
  section: SessionSection;
  onRestore: (metadata: M, title: string) => void;
}

/**
 * Sessions are addressed via `?session={id}` in the URL.
 * On mount / when the param changes, loadUserSession runs and the page
 * restores its state via `onRestore`.
 *
 * Pages call `save({ title, metadata })` after a successful operation.
 * The first save creates a row and adopts its id; subsequent saves update it.
 * `reset()` clears the local id so the next save creates a fresh row.
 */
export function usePageSession<M extends Record<string, unknown>>({ section, onRestore }: UsePageSessionArgs<M>) {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdRef = useRef<string | null>(null);
  const restoredForRef = useRef<string | null>(null);

  const paramId = searchParams.get("session");

  useEffect(() => {
    if (!user || !paramId) return;
    if (restoredForRef.current === paramId) return;
    restoredForRef.current = paramId;
    (async () => {
      const row = await loadUserSession(paramId, user.id);
      if (row && row.section === section) {
        sessionIdRef.current = row.id;
        onRestore(row.metadata as M, row.title);
      }
    })();
  }, [user, paramId, section, onRestore]);

  const save = useCallback(async (args: { title: string; metadata: M }) => {
    if (!user) return null;
    const id = await upsertUserSession({
      id: sessionIdRef.current,
      userId: user.id,
      section,
      title: args.title.slice(0, 80) || "Untitled",
      metadata: args.metadata,
    });
    if (id && !sessionIdRef.current) {
      sessionIdRef.current = id;
      // Reflect the newly-created id in the URL so reload / share preserves it.
      const next = new URLSearchParams(searchParams);
      next.set("session", id);
      setSearchParams(next, { replace: true });
    }
    return id;
  }, [user, section, searchParams, setSearchParams]);

  const reset = useCallback(() => {
    sessionIdRef.current = null;
    restoredForRef.current = null;
    if (searchParams.has("session")) {
      const next = new URLSearchParams(searchParams);
      next.delete("session");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  return { save, reset, currentId: sessionIdRef.current };
}
