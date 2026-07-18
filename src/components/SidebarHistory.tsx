import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MoreHorizontal, Pencil, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSessionHistory, type SessionSection, type SessionHistoryItem } from "@/hooks/useSessionHistory";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";

const SECTION_ROUTES: Record<SessionSection, string> = {
  transcribe: "/transcribe",
  speak: "/speak",
  ocr: "/ocr",
  research: "/research",
  editor: "/editor",
  translate: "/translate",
};

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.round((Date.now() - then) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return `${abs}s`;
  if (abs < 3600) return `${Math.round(abs / 60)}m`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h`;
  if (abs < 604800) return `${Math.round(abs / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

type DateBucket = "today" | "yesterday" | "last_week" | "older";

const BUCKET_ORDER: DateBucket[] = ["today", "yesterday", "last_week", "older"];
const BUCKET_LABEL_KEY: Record<DateBucket, string> = {
  today: "sidebar.group_today",
  yesterday: "sidebar.group_yesterday",
  last_week: "sidebar.group_last_week",
  older: "sidebar.group_older",
};

/** Classify a timestamp into a calendar-relative bucket (local time). */
function bucketFor(iso: string): DateBucket {
  const d = new Date(iso);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - 86400000);
  const startOfWeek = new Date(startOfToday.getTime() - 6 * 86400000);
  if (d >= startOfToday) return "today";
  if (d >= startOfYesterday) return "yesterday";
  if (d >= startOfWeek) return "last_week";
  return "older";
}

interface SidebarHistoryProps {
  section: SessionSection;
  activeId?: string | null;
  onSelect?: (item: SessionHistoryItem) => void;
  collapsed?: boolean;
}

const SidebarHistory = ({ section, activeId, onSelect, collapsed }: SidebarHistoryProps) => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { items, loading, available, rename, remove } = useSessionHistory(section);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const effectiveActiveId = activeId ?? searchParams.get("session");

  const defaultSelect = (item: SessionHistoryItem) => {
    navigate(`${SECTION_ROUTES[item.section]}?session=${item.id}`);
  };

  if (collapsed) return null;
  if (!available) return null;

  const startRename = (item: SessionHistoryItem) => {
    setRenamingId(item.id);
    setRenameValue(item.title);
  };

  const commitRename = async (id: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) await rename(id, trimmed);
    setRenamingId(null);
  };

  const startNewChat = () => {
    // Hard navigate so the section page remounts and any local state
    // (transcript, extracted text, chat messages) is cleared. This generic
    // control is shared across all sections; a client-side navigate would not
    // reliably clear each page's local state. (The Research page header has its
    // own in-place "New chat" that clears the chat without a reload.)
    window.location.href = SECTION_ROUTES[section];
  };

  const renderRow = (item: SessionHistoryItem) => {
    const isActive = item.id === effectiveActiveId;
    const isRenaming = item.id === renamingId;
    return (
      <div
        key={item.id}
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50"
        )}
      >
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => commitRename(item.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename(item.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            className="flex-1 bg-transparent text-sm outline-none border-b border-primary/50"
          />
        ) : (
          <button
            onClick={() => (onSelect ?? defaultSelect)(item)}
            className="flex-1 min-w-0 text-start truncate"
            title={item.title}
          >
            <span className="truncate">{item.title}</span>
          </button>
        )}

        <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
          {relativeTime(item.updated_at)}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 opacity-100 focus:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              aria-label={t("sidebar.history_item_menu") || "Item menu"}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={() => startRename(item)}>
              <Pencil className="h-3.5 w-3.5 me-2" />
              {t("sidebar.rename") || "Rename"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => remove(item.id)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 me-2" />
              {t("sidebar.delete") || "Delete"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  // `items` arrives already sorted by `updated_at` desc, so filtering per
  // bucket preserves recency order within each group.
  const groups = BUCKET_ORDER
    .map((bucket) => ({ bucket, rows: items.filter((i) => bucketFor(i.updated_at) === bucket) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-sidebar-foreground/60">
          {t("sidebar.history") || "History"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={startNewChat}
          className="h-7 gap-1 px-2 text-xs"
          aria-label={t("sidebar.new_chat") || "New"}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("sidebar.new_chat") || "New"}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {loading && items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">…</p>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {t("sidebar.history_empty") || "No sessions yet"}
          </p>
        ) : (
          groups.map((grp) => (
            <div key={grp.bucket} className="space-y-0.5">
              <p className="px-3 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-sidebar-foreground/50">
                {t(BUCKET_LABEL_KEY[grp.bucket])}
              </p>
              {grp.rows.map(renderRow)}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SidebarHistory;
