// Sessions sidebar — lists prior research sessions for the current user.
//
// Per Phase 10.5: the `research_sessions` table has been writing for a while,
// but there was no UI to browse past chats. This panel fixes that.
// Collapsible (drawer-style) on mobile, persistent column on desktop.

import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, Trash2, Search, BookOpen, Globe, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { listResearchSessions, type ResearchSessionSummary } from "@/lib/research/persistence";
import { useAuth } from "@/contexts/AuthContext";
import type { ResearchMode } from "./ResearchModeSwitcher";

interface SessionsSidebarProps {
  /** Refetch trigger — bumps when chat saves/deletes a session. */
  refreshKey: number;
  activeSessionId: string | null;
  /** Currently-selected research mode — used to filter the list when desired. */
  mode: ResearchMode;
  onNewChat: () => void;
  onLoadSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  t: (k: string) => string;
}

function relativeTime(iso: string, t: (k: string) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return new Date(iso).toLocaleDateString();
  const sec = Math.floor(ms / 1000);
  if (sec < 60)  return t("research.time_just_now")  || "just now";
  const min = Math.floor(sec / 60);
  if (min < 60)  return `${min}${t("research.time_min_short")  || "m"}`;
  const hr = Math.floor(min / 60);
  if (hr < 24)   return `${hr}${t("research.time_hr_short")   || "h"}`;
  const d = Math.floor(hr / 24);
  if (d < 7)     return `${d}${t("research.time_day_short")   || "d"}`;
  return new Date(iso).toLocaleDateString();
}

const SessionsSidebar = ({
  refreshKey,
  activeSessionId,
  mode,
  onNewChat,
  onLoadSession,
  onDeleteSession,
  t,
}: SessionsSidebarProps) => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ResearchSessionSummary[]>([]);
  const [loading, setLoading]   = useState(false);
  const [filter, setFilter]     = useState("");
  const [scopeAll, setScopeAll] = useState(true); // show all modes vs current mode only

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const rows = await listResearchSessions(user.id, 80);
    setSessions(rows);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return sessions.filter((s) => {
      if (!scopeAll && s.mode !== mode) return false;
      if (!needle) return true;
      return s.title.toLowerCase().includes(needle);
    });
  }, [sessions, filter, scopeAll, mode]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <Button
          size="sm"
          variant="default"
          className="flex-1 gap-1.5 text-xs"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          {t("research.new_chat") || "New chat"}
        </Button>
      </div>

      <div className="p-2 space-y-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("research.sessions_search") || "Search past chats…"}
            className="h-8 pl-7 pr-7 text-xs"
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="clear"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={scopeAll}
            onChange={(e) => setScopeAll(e.target.checked)}
            className="h-3 w-3 accent-primary"
          />
          {t("research.sessions_show_all_modes") || "Show all tabs"}
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && sessions.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">{t("research.sessions_loading") || "Loading…"}</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">
            {filter
              ? (t("research.sessions_no_match") || "No matching sessions")
              : (t("research.sessions_empty")    || "No past chats yet")}
          </p>
        ) : (
          <ul className="py-1">
            {visible.map((s) => {
              const isActive = s.id === activeSessionId;
              const Icon = s.mode === "islamic" ? BookOpen : Globe;
              return (
                <li key={s.id}>
                  <div
                    className={cn(
                      "group flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 transition-colors",
                      isActive && "bg-primary/10 border-l-2 border-l-primary",
                    )}
                    onClick={() => onLoadSession(s.id)}
                  >
                    <Icon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", isActive ? "text-primary" : "text-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs truncate" title={s.title}>{s.title}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {relativeTime(s.updated_at, t)} · {s.message_count} {t("research.messages_short") || "msgs"}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(t("research.delete_session_confirm") || "Delete this chat?")) {
                          onDeleteSession(s.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                      aria-label="delete session"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SessionsSidebar;
