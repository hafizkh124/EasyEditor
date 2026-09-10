/**
 * Plan §3.5 — one seam for research-session persistence.
 *
 *   userId present            → SupabaseSessionStore  (wraps persistence.ts verbatim)
 *   userId absent + desktop    → LocalSessionStore     (IPC → electron/db research_sessions)
 *   userId absent + web        → NoopSessionStore      (nothing to save — unchanged)
 *
 * `useResearchChat` calls `getSessionStore(user?.id ?? null)` and never branches
 * itself, so the "cloud vs local vs nothing" decision lives in exactly one place.
 */
import type { ChatMessage } from "@/components/research/types";
import type { CitationItem } from "@/components/research/CitationPanel";
import {
  upsertResearchSession as sbUpsert,
  loadLatestResearchSession as sbLoadLatest,
  loadResearchSession as sbLoad,
  deleteResearchSession as sbDelete,
} from "@/lib/research/persistence";

export interface ResearchSessionData {
  id: string;
  title: string;
  mode: string;
  messages: ChatMessage[];
  citations: CitationItem[];
  selected_domains: string[];
  updated_at: string;
}

export interface UpsertParams {
  id: string | null;
  title: string;
  mode: "general" | "islamic";
  messages: ChatMessage[];
  citations: CitationItem[];
  selectedDomains: string[];
}

export interface SessionStore {
  upsert(p: UpsertParams): Promise<string | null>;
  loadLatest(mode: "general" | "islamic"): Promise<ResearchSessionData | null>;
  load(id: string): Promise<ResearchSessionData | null>;
  remove(id: string): Promise<void>;
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && Boolean((window as { electronAPI?: unknown }).electronAPI);
}

async function localInvoke<T>(method: string, ...args: unknown[]): Promise<T> {
  return (window as unknown as { electronAPI: { invoke: (c: string, p: unknown) => Promise<T> } }).electronAPI.invoke(
    "workspace:invoke",
    { method, args },
  );
}

class SupabaseSessionStore implements SessionStore {
  constructor(private readonly userId: string) {}
  upsert(p: UpsertParams) {
    return sbUpsert({ ...p, userId: this.userId });
  }
  loadLatest(mode: "general" | "islamic") {
    return sbLoadLatest(this.userId, mode) as Promise<ResearchSessionData | null>;
  }
  load(id: string) {
    return sbLoad(id, this.userId) as Promise<ResearchSessionData | null>;
  }
  remove(id: string) {
    return sbDelete(id, this.userId);
  }
}

class LocalSessionStore implements SessionStore {
  async upsert(p: UpsertParams) {
    try {
      return await localInvoke<string>("upsertResearchSession", {
        id: p.id, title: p.title, mode: p.mode, messages: p.messages, citations: p.citations, selectedDomains: p.selectedDomains,
      });
    } catch {
      return null;
    }
  }
  async loadLatest(mode: "general" | "islamic") {
    try { return await localInvoke<ResearchSessionData | null>("loadLatestResearchSession", mode); } catch { return null; }
  }
  async load(id: string) {
    try { return await localInvoke<ResearchSessionData | null>("loadResearchSession", id); } catch { return null; }
  }
  async remove(id: string) {
    try { await localInvoke("deleteResearchSession", id); } catch { /* ignore */ }
  }
}

const NOOP: SessionStore = {
  async upsert() { return null; },
  async loadLatest() { return null; },
  async load() { return null; },
  async remove() { /* nothing */ },
};

export function getSessionStore(userId: string | null): SessionStore {
  if (userId) return new SupabaseSessionStore(userId);
  if (isDesktop()) return new LocalSessionStore();
  return NOOP;
}
