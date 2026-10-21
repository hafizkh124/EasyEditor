import { useContext, useEffect, useRef } from "react";
import { UNSAFE_LocationContext } from "react-router-dom";
import { getSessionStore } from "@/lib/sessions/store";
import type { ChatMessage } from "@/components/research/types";
import { logger } from "@/lib/logger";

const log = logger.child("useChatPersistence");

/**
 * Saves the chat and opens a saved one (SYSTEM-2026 §3).
 *
 * The chat (useAgentRun) kept its thread only in memory, so a conversation was
 * gone on reload and every `?session=` link — Home, the sidebar, History —
 * opened an empty chat. Each finished answer now saves the thread as
 * question/answer pairs in the same session store the old research chat used
 * (Supabase when signed in, the local database on a desktop without an
 * account), with the folder the chat was started in.
 *
 * Only the text is kept. Tool cards and artifacts belong to the run that made
 * them and are not restored.
 */

export interface SavedExchange {
  instruction: string;
  answer: string;
}

export function exchangesToMessages(exchanges: SavedExchange[]): ChatMessage[] {
  return exchanges.flatMap((e) => [
    { role: "user" as const, content: e.instruction },
    { role: "assistant" as const, content: e.answer },
  ]);
}

export function messagesToExchanges(messages: unknown): SavedExchange[] {
  if (!Array.isArray(messages)) return [];
  const out: SavedExchange[] = [];
  for (const m of messages as Array<{ role?: string; content?: unknown }>) {
    const content = typeof m?.content === "string" ? m.content : "";
    if (m?.role === "user") out.push({ instruction: content, answer: "" });
    else if (m?.role === "assistant" && out.length) out[out.length - 1].answer = content;
  }
  return out.filter((e) => e.instruction || e.answer);
}

export const NEW_CHAT_EVENT = "research-new-session";
export const HISTORY_CHANGED_EVENT = "session-history-changed";

export function useChatPersistence({
  userId,
  exchanges,
  running,
  folderId,
  restore,
  reset,
  sessionRequest,
}: {
  userId: string | null;
  /** The whole thread, the latest finished answer included. */
  exchanges: SavedExchange[];
  running: boolean;
  folderId: string | null;
  restore: (exchanges: SavedExchange[]) => void;
  reset: () => void;
  /** An in-app request to open a saved chat (WorkspaceContext.openChatSession). */
  sessionRequest?: { id: string; nonce: number } | null;
}) {
  const sessionIdRef = useRef<string | null>(null);
  const folderRef = useRef<string | null>(null);
  const lastSavedRef = useRef("");
  // Saves run one after another, so the first one's new id is known before
  // the next save — otherwise two quick answers could create two sessions.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // Save after each finished answer.
  useEffect(() => {
    if (running || exchanges.length === 0) return;
    const messages = exchangesToMessages(exchanges);
    const key = JSON.stringify(messages);
    if (key === lastSavedRef.current) return;
    lastSavedRef.current = key;
    // The chat belongs to the folder it was started in.
    if (sessionIdRef.current === null && folderRef.current === null) folderRef.current = folderId;
    const title = exchanges[0].instruction.trim().slice(0, 80) || "…";
    const store = getSessionStore(userId);
    queueRef.current = queueRef.current.then(async () => {
      try {
        const id = await store.upsert({
          id: sessionIdRef.current,
          title,
          mode: "general",
          messages,
          citations: [],
          selectedDomains: [],
          projectId: folderRef.current,
        });
        const isNew = Boolean(id && !sessionIdRef.current);
        if (id) sessionIdRef.current = id;
        if (isNew) window.dispatchEvent(new CustomEvent(HISTORY_CHANGED_EVENT, { detail: { section: "research" } }));
      } catch (err) {
        log.debug("saving the chat failed", { err });
      }
    });
  }, [exchanges, running, userId, folderId]);

  // Open the chat a `?session=` link names. The location is read from context
  // so the hook also works where no router is mounted.
  const search = useContext(UNSAFE_LocationContext)?.location?.search ?? "";
  const requested = sessionRequest?.id ?? new URLSearchParams(search).get("session");
  // A repeated in-app request for the open chat reloads it; a re-render does not.
  const requestNonce = sessionRequest?.nonce ?? 0;
  const handledNonceRef = useRef(0);
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    if (!requested) return;
    if (requested === sessionIdRef.current && requestNonce === handledNonceRef.current) return;
    handledNonceRef.current = requestNonce;
    let cancelled = false;
    void getSessionStore(userId)
      .load(requested)
      .then((data) => {
        if (cancelled || !data) return;
        const restored = messagesToExchanges(data.messages);
        // Restore first: it clears the current thread, which forgets the
        // current session — then take on the opened one.
        restoreRef.current(restored);
        sessionIdRef.current = data.id;
        folderRef.current = (data as { project_id?: string | null }).project_id ?? null;
        lastSavedRef.current = JSON.stringify(exchangesToMessages(restored));
      })
      .catch((err: unknown) => log.debug("opening the chat failed", { err }));
    return () => {
      cancelled = true;
    };
  }, [requested, requestNonce, userId]);

  // "New chat" starts a new session.
  const resetRef = useRef(reset);
  resetRef.current = reset;
  useEffect(() => {
    const onNew = () => {
      sessionIdRef.current = null;
      folderRef.current = null;
      lastSavedRef.current = "";
      resetRef.current();
    };
    window.addEventListener(NEW_CHAT_EVENT, onNew);
    return () => window.removeEventListener(NEW_CHAT_EVENT, onNew);
  }, []);

  /** Forget the current session, so the next answer starts a new one. */
  return {
    forgetSession: () => {
      sessionIdRef.current = null;
      folderRef.current = null;
      lastSavedRef.current = "";
    },
  };
}
