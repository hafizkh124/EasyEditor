import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, FileText, MessageSquareText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentItems } from "@/hooks/useRecentItems";
import type { Translator } from "@/lib/i18n";
import type { NavItem } from "./appNav";

/**
 * The desktop/web sidebar (SYSTEM-2026 §2, Claude-style): "+ New" at the top,
 * then Home and Files, then one recent list of chats and documents, and "Me"
 * at the bottom.
 */

const RECENT_LIMIT = 12;

const SectionNavItem = ({
  item, isActive, collapsed, onClick, t,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick?: () => void;
  t: Translator;
}) => (
  <Link
    to={item.path}
    onClick={onClick}
    aria-current={isActive ? "page" : undefined}
    className={cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      collapsed && "justify-center px-2",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
    )}
    title={collapsed ? t(item.labelKey, item.fallbackLabel) : undefined}
  >
    <item.icon className={cn("h-[18px] w-[18px] shrink-0", isActive && "text-primary")} aria-hidden="true" />
    {!collapsed && <span>{t(item.labelKey, item.fallbackLabel)}</span>}
  </Link>
);

const SidebarRecent = ({ onItemClick, t }: { onItemClick?: () => void; t: Translator }) => {
  const { items, loading } = useRecentItems(RECENT_LIMIT);
  return (
    <section aria-labelledby="sidebar-recent" className="flex min-h-0 flex-1 flex-col">
      <h2 id="sidebar-recent" className="px-4 pb-1 pt-3 text-xs font-semibold text-muted-foreground">
        {t("home.recent", "حالیہ")}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading ? (
          <div className="space-y-1.5 px-1">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-7 w-full" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("home.recent_empty", "آپ کی چیٹس اور دستاویزات یہاں نظر آئیں گی۔")}</p>
        ) : (
          <ul className="space-y-0.5">
            {items.map((item) => {
              const Icon = item.kind === "chat" ? MessageSquareText : FileText;
              const typeLabel = item.kind === "chat" ? t("home.type_chat", "چیٹ") : t("home.type_document", "دستاویز");
              const title = item.title || t("editor.untitled", "بے عنوان");
              return (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    onClick={onItemClick}
                    title={title}
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={typeLabel} />
                    <span className="truncate">{title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

export interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onItemClick?: () => void;
  activePath: string;
  navItems: NavItem[];
  t: Translator;
  showCollapseButton: boolean;
  /** The "+ New" create menu, rendered under the logo. */
  createSlot?: React.ReactNode;
  /** "Me" (the account menu), pinned to the bottom. */
  footerSlot?: React.ReactNode;
}

export const AppSidebar = ({
  collapsed, onToggleCollapse, onItemClick, activePath,
  navItems, t, showCollapseButton, createSlot, footerSlot,
}: AppSidebarProps) => (
  <div className="flex h-full flex-col bg-sidebar">
    <div className={cn(
      "flex h-14 items-center border-b border-sidebar-border",
      collapsed ? "justify-center px-2" : "justify-between px-4",
    )}>
      <Link to="/" onClick={onItemClick} className="flex items-center gap-2.5 min-w-0">
        <img src={`${import.meta.env.BASE_URL}favicon.webp`} alt="Easy Editor" width={26} height={26} className="rounded shrink-0" />
        {!collapsed && <span className="text-lg font-bold text-sidebar-foreground tracking-tight truncate">Easy Editor</span>}
      </Link>
      {showCollapseButton && !collapsed && onToggleCollapse && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="h-9 w-9"
          aria-label={t("sidebar.collapse", "Collapse sidebar")}
          title="Ctrl+B"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      )}
    </div>

    {showCollapseButton && collapsed && onToggleCollapse && (
      <div className="flex justify-center py-1 border-b border-sidebar-border">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="h-9 w-9"
          aria-label={t("sidebar.expand", "Expand sidebar")}
          title="Ctrl+B"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    )}

    {createSlot && <div className={cn("px-2 pt-3", collapsed && "px-3")}>{createSlot}</div>}

    <nav aria-label={t("nav.menu", "مینو")} className="shrink-0 space-y-0.5 p-2">
      {navItems.map((item) => (
        <SectionNavItem
          key={item.path}
          item={item}
          isActive={activePath === item.path || activePath.startsWith(item.path + "/")}
          collapsed={collapsed}
          onClick={onItemClick}
          t={t}
        />
      ))}
    </nav>

    {collapsed ? <div className="flex-1" /> : (
      <>
        <div className="mx-4 border-t border-sidebar-border" />
        <SidebarRecent onItemClick={onItemClick} t={t} />
      </>
    )}

    {footerSlot && <div className="border-t border-sidebar-border p-2">{footerSlot}</div>}
  </div>
);

export default AppSidebar;
