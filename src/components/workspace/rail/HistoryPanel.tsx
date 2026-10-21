import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  MessageSquare, Search, MoreHorizontal, Pencil, Trash2, Bot, RotateCcw, Plus, Trash,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/workspace/EmptyState";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useSessionHistory, type SessionHistoryItem } from "@/hooks/useSessionHistory";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { groupByBucket, BUCKET_LABEL_KEY, relativeTime } from "@/lib/history/dateBuckets";
import { isDesktop } from "@/core/backend";
import { cn } from "@/lib/utils";

/**
 * Plan §3.4 — the 🕒 تاریخ rail panel. Two sub-views: research/agent Sessions
 * (resume / rename / delete) and the NEW Search history (one-click re-run).
 */

type View = "sessions" | "searches";

const KIND_LABEL: Record<string, string> = {
  shamela: "مکتبہ شاملہ",
  corpus: "ذاتی لائبریری",
  jkhssn: "جوامع الكلم",
  resource: "وسائل",
  hadith: "حدیث",
};

export const HistoryPanel: React.FC = () => {
  const { t } = useLanguage();
  const [view, setView] = useState<View>("sessions");

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-1 border-b border-sidebar-border p-2">
        <span className="me-auto ps-1 text-xs font-semibold uppercase tracking-wide">{t("rail.history", "تاریخ")}</span>
        <div className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
          {(["sessions", "searches"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                view === v ? "bg-background text-foreground shadow-sm font-medium" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "sessions" ? <MessageSquare className="h-3 w-3" /> : <Search className="h-3 w-3" />}
              {v === "sessions" ? t("history.tab_sessions", "سیشنز") : t("history.tab_searches", "تلاش")}
            </button>
          ))}
        </div>
      </div>
      {view === "sessions" ? <SessionsView /> : <SearchesView />}
    </div>
  );
};

// ── Sessions ─────────────────────────────────────────────────────────────────

const SessionsView: React.FC = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { items, loading, available, rename, remove } = useSessionHistory("research");
  const { setWorkbenchTab } = useWorkspace();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const resume = (item: SessionHistoryItem) => {
    setWorkbenchTab("research");
    navigate(`/workspace?panel=research&session=${item.id}`);
  };

  const newSession = () => {
    setWorkbenchTab("research");
    navigate("/workspace?panel=research");
    window.dispatchEvent(new CustomEvent("research-new-session"));
  };

  if (!available && !user) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={MessageSquare}
          title={t("history.signed_out_title", "سیشن محفوظ کرنے کے لیے سائن اِن کریں")}
          description={t("history.signed_out_desc", "سائن اِن کرنے کے بعد آپ کے تحقیقی سیشن یہاں محفوظ رہیں گے۔")}
          action={<Button size="sm" onClick={() => navigate("/login")}>{t("nav.sign_in", "سائن اِن")}</Button>}
        />
      </div>
    );
  }

  const groups = groupByBucket(items, (i) => i.updated_at);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs text-muted-foreground">{items.length}</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={newSession}>
          <Plus className="h-3.5 w-3.5" />{t("sidebar.new_chat", "نیا سیشن")}
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-0.5 px-2 pb-2">
          {loading && items.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">{t("sidebar.history_empty", "ابھی کوئی سیشن نہیں")}</p>
          ) : (
            groups.map((g) => (
              <div key={g.bucket} className="space-y-0.5">
                <p className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wider text-sidebar-foreground/50">
                  {t(BUCKET_LABEL_KEY[g.bucket])}
                </p>
                {g.rows.map((item) => (
                  <div key={item.id} className="group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50">
                    {renamingId === item.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => { void rename(item.id, renameValue.trim() || item.title); setRenamingId(null); }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { void rename(item.id, renameValue.trim() || item.title); setRenamingId(null); }
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="flex-1 rounded-sm border-b border-primary/50 bg-transparent text-sm focus-visible:outline-none"
                      />
                    ) : (
                      <button onClick={() => resume(item)} className="min-w-0 flex-1 truncate text-start" title={item.title}>
                        <Bot className="me-1.5 inline h-3 w-3 text-muted-foreground" />
                        {item.title}
                      </button>
                    )}
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{relativeTime(item.updated_at)}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100" aria-label={t("common.more", "مزید")}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-36">
                        <DropdownMenuItem onClick={() => { setRenamingId(item.id); setRenameValue(item.title); }}>
                          <Pencil className="me-2 h-3.5 w-3.5" />{t("common.rename", "نام بدلیں")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => { if (window.confirm(t("history.delete_confirm", "یہ سیشن حذف کریں؟"))) void remove(item.id); }}
                        >
                          <Trash2 className="me-2 h-3.5 w-3.5" />{t("common.delete", "حذف کریں")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

// ── Searches ─────────────────────────────────────────────────────────────────

const SearchesView: React.FC = () => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { entries, available, loading, remove, clear } = useSearchHistory();
  const { openRailPanel } = useWorkspace();

  const rerun = (e: { kind: string; query: string; filters: Record<string, unknown> }) => {
    if (e.kind === "shamela" || e.kind === "corpus") {
      openRailPanel("library");
      window.dispatchEvent(new CustomEvent("workspace-rerun-search", { detail: e }));
    } else if (e.kind === "jkhssn") {
      window.dispatchEvent(new CustomEvent("workspace-rerun-search", { detail: e }));
    }
  };

  if (!available) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          icon={Search}
          title={t("history.searches_unavailable_title", "تلاش کی تاریخ ابھی دستیاب نہیں")}
          description={
            !user && !isDesktop()
              ? t("history.searches_signed_out", "سائن اِن کریں یا ڈیسک ٹاپ ایپ استعمال کریں۔")
              : t("history.searches_pending", "یہ فیچر جلد دستیاب ہوگا۔")
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {entries.length > 0 && (
        <div className="flex justify-end px-3 py-1.5">
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground" onClick={() => { if (window.confirm(t("history.clear_confirm", "ساری تلاش کی تاریخ صاف کریں؟"))) void clear(); }}>
            <Trash className="h-3.5 w-3.5" />{t("history.clear", "صاف کریں")}
          </Button>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-0.5 px-2 pb-2">
          {loading && entries.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">…</p>
          ) : entries.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">{t("history.searches_empty", "ابھی کوئی تلاش نہیں")}</p>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent/50">
                <button onClick={() => rerun(e)} className="min-w-0 flex-1 text-start">
                  <span className="block truncate">{e.query}</span>
                  <span className="block text-xs text-muted-foreground">
                    {KIND_LABEL[e.kind] ?? e.kind}
                    {e.resultCount != null ? ` · ${e.resultCount}` : ""} · {relativeTime(e.createdAt)}
                  </span>
                </button>
                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => rerun(e)} aria-label={t("history.rerun", "دوبارہ چلائیں")}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => remove(e.id)} aria-label={t("common.delete", "حذف کریں")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
