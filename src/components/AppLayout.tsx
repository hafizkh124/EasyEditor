import { useLocation, Link, useMatch } from "react-router-dom";
import {
  BookOpen, Menu, Shield, Bell, User, ChevronLeft, ChevronRight, ChevronDown, Layers,
  Wrench, Mic, ScanText, Volume2, Languages, Settings as SettingsIcon,
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useNotifications } from "@/contexts/NotificationContext";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import SidebarHistory from "@/components/SidebarHistory";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import AppVersionBadge from "@/components/AppVersionBadge";
import ModeBadge from "@/components/ModeBadge";
import { DesktopAccountMenu } from "@/components/auth/DesktopAccountMenu";
import { isDesktop } from "@/utils/environment";
import type { SessionSection } from "@/hooks/useSessionHistory";

/**
 * FR-7 — ten nav items collapsed into three groups. The individual tools keep
 * their own routes and are reached through the Tools group, so nothing that
 * used to be one click away became unreachable.
 *
 * `desktop` marks whether a tool survives in the Electron build. This is one of
 * only three places allowed to branch on the runtime target (SPEC-M5 §4.3); the
 * others are `getBackend()` and the mode badge.
 *
 * SPEC-M5 FR-2.5: absent, never disabled. A greyed-out button that can only
 * ever fail teaches the user the app is broken. OCR, Extract and Translate all
 * depend on cloud edge functions with no local counterpart, so in desktop mode
 * they simply do not exist.
 *
 * Transcribe and Speak DO survive — they gain local Whisper and Piper engines
 * in M5.5 — but they stay hidden until `VITE_LOCAL_VOICE` is on, because until
 * then they would reach for a cloud function that desktop has no session for.
 */
type ToolItem = {
  path: string;
  icon: typeof BookOpen;
  labelKey: string;
  fallbackLabel?: string;
  desktop?: "always" | "with-local-voice";
};

const ALL_TOOLS: ToolItem[] = [
  { path: "/transcribe", icon: Mic, labelKey: "nav.transcribe", fallbackLabel: "ٹرانسکرائب", desktop: "with-local-voice" },
  { path: "/ocr", icon: ScanText, labelKey: "nav.ocr", fallbackLabel: "OCR" },
  { path: "/speak", icon: Volume2, labelKey: "nav.speak", fallbackLabel: "بولیں", desktop: "with-local-voice" },
  { path: "/extract", icon: Layers, labelKey: "nav.extract", fallbackLabel: "استخراج" },
  { path: "/translate", icon: Languages, labelKey: "nav.translate", fallbackLabel: "ترجمہ" },
];

const LOCAL_VOICE_ENABLED = import.meta.env.VITE_LOCAL_VOICE === "true";

const toolsChildren = !isDesktop()
  ? ALL_TOOLS
  : ALL_TOOLS.filter(
      (t) => t.desktop === "always" || (t.desktop === "with-local-voice" && LOCAL_VOICE_ENABLED),
    );

const sectionNav = [
  { path: "/workspace", icon: BookOpen, labelKey: "nav.workspace", fallbackLabel: "ورک اسپیس", section: "editor" as SessionSection },
  // The Tools group disappears entirely when it would otherwise be empty.
  ...(toolsChildren.length > 0
    ? [{ path: toolsChildren[0].path, icon: Wrench, labelKey: "nav.tools", fallbackLabel: "ٹولز (Tools)", section: "transcribe" as SessionSection, children: toolsChildren }]
    : []),
  { path: "/settings", icon: SettingsIcon, labelKey: "nav.settings", fallbackLabel: "ترتیبات (Settings)", section: null },
];
const adminNavItem = { path: "/admin", icon: Shield, labelKey: "nav.admin", fallbackLabel: "ایڈمن", section: null };

type NavChild = { path: string; icon: typeof BookOpen; labelKey: string; fallbackLabel?: string };
type NavItem = {
  path: string;
  icon: typeof BookOpen;
  labelKey: string;
  section: SessionSection | null;
  children?: NavChild[];
};

function useActiveSection(): SessionSection | null {
  const location = useLocation();
  const found = sectionNav.find((i) => location.pathname.startsWith(i.path));
  return found?.section ?? null;
}

/* ─── Notification Bell ─── */
const NotificationBell = () => {
  const { t } = useLanguage();
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-10 w-10 text-muted-foreground hover:text-foreground" aria-label={t("notification.title")}>
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute top-1 end-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <p className="font-semibold text-sm">{t("notification.title")}</p>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-auto py-0.5 px-2 text-xs" onClick={markAllRead}>
              {t("notification.mark_all_read")}
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8 px-4">{t("notification.empty")}</p>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => !n.is_read && markRead(n.id)}
                  className={cn(
                    "w-full text-start px-4 py-3 hover:bg-accent/50 transition-colors",
                    !n.is_read && "bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.is_read && <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />}
                    <div className={cn("space-y-0.5", n.is_read && "ms-4")}>
                      <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                      <p className="text-xs text-muted-foreground leading-snug">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground/70">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

/* ─── Section Nav Item ─── */
const SectionNavItem = ({
  item, isActive, collapsed, onClick, t,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
  onClick?: () => void;
  t: (key: string) => string;
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
    title={collapsed ? t(item.labelKey) : undefined}
  >
    <item.icon className={cn("h-[18px] w-[18px] flex-shrink-0", isActive && "text-primary")} />
    {!collapsed && <span>{t(item.labelKey) !== item.labelKey ? t(item.labelKey) : ((item as any).fallbackLabel || t(item.labelKey))}</span>}
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
  t: (key: string) => string;
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
          {t(item.labelKey) !== item.labelKey ? t(item.labelKey) : ((item as any).fallbackLabel || item.labelKey)}
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
  t: (key: string) => string;
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
        title={collapsed ? (t("nav.profile") || "Profile") : undefined}
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

/* ─── Sidebar Body (shared desktop + mobile drawer) ─── */
interface SidebarBodyProps {
  collapsed: boolean;
  onToggleCollapse?: () => void;
  onItemClick?: () => void;
  activeSection: SessionSection | null;
  activePath: string;
  navItems: NavItem[];
  user: { email?: string } | null;
  t: (key: string) => string;
  showCollapseButton: boolean;
}

const SidebarBody = ({
  collapsed, onToggleCollapse, onItemClick, activeSection, activePath,
  navItems, user, t, showCollapseButton,
}: SidebarBodyProps) => (
  <div className="flex h-full flex-col bg-sidebar">
    <div className={cn(
      "flex h-14 items-center border-b border-sidebar-border",
      collapsed ? "justify-center px-2" : "justify-between px-5",
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
          aria-label={t("sidebar.collapse") || "Collapse sidebar"}
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
          aria-label={t("sidebar.expand") || "Expand sidebar"}
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

/* ─── Main Layout ─── */
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, direction } = useLanguage();
  const { user } = useAuth();
  const { isAdmin } = useApproval();
  const location = useLocation();
  const [collapsed, , toggleCollapsed] = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeSection = useActiveSection();

  const navItems: NavItem[] = isAdmin ? [...sectionNav, adminNavItem] : sectionNav;

  return (
    <div className="flex min-h-screen bg-background" dir={direction}>
      {/* Skip-to-main link (Phase 6 a11y) — visible only when focused via keyboard. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t("a11y.skip_to_main") || "Skip to main content"}
      </a>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden md:flex md:flex-col border-e border-sidebar-border shrink-0 transition-[width] duration-200",
          collapsed ? "md:w-16" : "md:w-60 lg:w-64",
        )}
      >
        <SidebarBody
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          activeSection={activeSection}
          activePath={location.pathname}
          navItems={navItems}
          user={user}
          t={t}
          showCollapseButton
        />
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        <SubscriptionBanner />
        {/* Mobile Top Bar */}
        <header className="flex h-14 items-center gap-3 border-b border-border px-4 md:hidden bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={t("sidebar.open") || "Open menu"}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side={direction === "rtl" ? "right" : "left"} className="p-0 w-[min(20rem,85vw)] bg-sidebar border-e border-sidebar-border">
              <SidebarBody
                collapsed={false}
                onItemClick={() => setDrawerOpen(false)}
                activeSection={activeSection}
                activePath={location.pathname}
                navItems={navItems}
                user={user}
                t={t}
                showCollapseButton={false}
              />
            </SheetContent>
          </Sheet>
          <Link to="/" className="flex items-center gap-2 flex-1 min-w-0">
            <img src="/favicon.webp" alt="Easy Editor" width={24} height={24} className="rounded" />
            <span className="text-base font-bold text-foreground truncate">Easy Editor</span>
          </Link>
          <DesktopAccountMenu />
          <ModeBadge />
          <NotificationBell />
        </header>

        {/* Desktop Top Bar */}
        <div className="hidden md:flex h-14 items-center justify-between border-b border-border px-6 bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <AppVersionBadge compact />
            <ModeBadge />
          </div>
          <div className="flex items-center gap-2">
            <DesktopAccountMenu />
            <NotificationBell />
          </div>
        </div>

        <main id="main-content" className="flex-1 overflow-auto pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile Bottom Navigation — trimmed to the 4 core sections */}
        <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm md:hidden pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-around h-16">
            {sectionNav.map((item) => {
              const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + "/");
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-lg transition-colors min-w-touch min-h-touch flex-1",
                    isActive ? "text-primary" : "text-muted-foreground active:text-foreground",
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                  <span className="text-[11px] font-medium leading-none">{t(item.labelKey)}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
};

export default AppLayout;
