import { useState } from "react";
import { Link, useMatch } from "react-router-dom";
import { ChevronLeft, ChevronRight, ChevronDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import SidebarHistory from "@/components/SidebarHistory";
import type { Translator } from "@/lib/i18n";
import type { SessionSection } from "@/hooks/useSessionHistory";
import type { NavItem } from "./appNav";

/* ─── Section Nav Item ─── */
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
    className={cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
      collapsed && "justify-center px-2",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
    )}
    title={collapsed ? t(item.labelKey, item.fallbackLabel) : undefined}
  >
    <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", isActive && "text-primary")} />
    {!collapsed && <span>{t(item.labelKey, item.fallbackLabel)}</span>}
  </Link>
);

/* ─── Section Nav Group (FR-7) — a heading that expands to its own routes ─── */
const SectionNavGroup = ({
  item, activePath, collapsed, onItemClick, t,
}: {
  item: NavItem;
  activePath: string;
  collapsed: boolean;
  onItemClick?: () => void;
  t: Translator;
}) => {
  const children = item.children ?? [];
  const isChildActive = (path: string) => activePath === path || activePath.startsWith(path + "/");
  const groupActive = children.some((c) => isChildActive(c.path));
  const [open, setOpen] = useState(groupActive);

  const childItems = children.map((c) => (
    <SectionNavItem
      key={c.path}
      item={{ ...c, section: null }}
      isActive={isChildActive(c.path)}
      collapsed={collapsed}
      onClick={onItemClick}
      t={t}
    />
  ));

  // Collapsed rail: no room for a heading, so the tools stand on their own.
  if (collapsed) return <div className="space-y-0.5">{childItems}</div>;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
          groupActive
            ? "text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
        )}
      >
        <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", groupActive && "text-primary")} />
        <span className="flex-1 text-start">
          {t(item.labelKey, item.fallbackLabel)}
        </span>
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="ms-4 ps-2 border-s border-sidebar-border space-y-0.5">{childItems}</div>}
    </div>
  );
};

/* ─── Profile Footer (FR-2.7) — logout lives on /profile per FR-5.2 ─── */
const ProfileFooter = ({
  user, collapsed, onNavigate, t,
}: {
  user: { email?: string } | null;
  collapsed: boolean;
  onNavigate?: () => void;
  t: Translator;
}) => {
  const isOnProfile = useMatch("/profile");
  return (
    <div className="border-t border-sidebar-border p-2">
      <Link
        to="/profile"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-2 transition-colors group",
          collapsed && "justify-center",
          isOnProfile
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "hover:bg-sidebar-accent/50"
        )}
        title={collapsed ? t("nav.profile", "Profile") : undefined}
      >
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
        {!collapsed && (
          <p className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">
            {user?.email}
          </p>
        )}
      </Link>
    </div>
  );
};

/* ─── Sidebar Body (shared by the desktop rail and the mobile drawer) ─── */
export interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onItemClick?: () => void;
  activeSection: SessionSection | null;
  activePath: string;
  navItems: NavItem[];
  user: { email?: string } | null;
  t: Translator;
  showCollapseButton: boolean;
}

export const AppSidebar = ({
  collapsed, onToggleCollapse, onItemClick, activeSection, activePath,
  navItems, user, t, showCollapseButton,
}: AppSidebarProps) => (
  <div className="flex h-full flex-col bg-sidebar">
    <div className={cn(
      "flex h-14 items-center border-b border-sidebar-border",
      collapsed ? "justify-center px-2" : "justify-between px-4",
    )}>
      <Link to="/" onClick={onItemClick} className="flex items-center gap-2.5 min-w-0">
        <img src="/favicon.webp" alt="Easy Editor" width={26} height={26} className="rounded flex-shrink-0" />
        {!collapsed && <span className="text-lg font-bold text-sidebar-foreground tracking-tight truncate">Easy Editor</span>}
      </Link>
      {showCollapseButton && !collapsed && onToggleCollapse && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="h-9 w-9"
          aria-label={t("sidebar.collapse", "Collapse sidebar")}
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
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    )}

    <nav className="flex-shrink-0 space-y-0.5 p-2">
      {navItems.map((item) =>
        item.children?.length ? (
          <SectionNavGroup
            key={item.path}
            item={item}
            activePath={activePath}
            collapsed={collapsed}
            onItemClick={onItemClick}
            t={t}
          />
        ) : (
          <SectionNavItem
            key={item.path}
            item={item}
            isActive={activePath === item.path || activePath.startsWith(item.path + "/")}
            collapsed={collapsed}
            onClick={onItemClick}
            t={t}
          />
        ),
      )}
    </nav>

    {activeSection && !collapsed && (
      <>
        <div className="border-t border-sidebar-border" />
        {/* Research has its own header "New chat" button — suppress the
            duplicate here to keep a single new-chat entry point. */}
        <SidebarHistory section={activeSection} collapsed={collapsed} showNewChat={activeSection !== "research"} />
      </>
    )}

    {(!activeSection || collapsed) && <div className="flex-1" />}

    <ProfileFooter user={user} collapsed={collapsed} onNavigate={onItemClick} t={t} />
  </div>
);

export default AppSidebar;
