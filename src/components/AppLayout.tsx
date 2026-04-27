import { useLocation, Link, useMatch } from "react-router-dom";
import {
  Mic, Volume2, Image, BookOpen, Menu, Shield,
  Bell, User, ChevronLeft, ChevronRight,
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
import type { SessionSection } from "@/hooks/useSessionHistory";

// FR-2.2: Research, Transcribe, OCR, Speak, Admin (admin conditional)
const sectionNav = [
  { path: "/research", icon: BookOpen, labelKey: "nav.research", section: "research" as SessionSection },
  { path: "/transcribe", icon: Mic, labelKey: "nav.transcribe", section: "transcribe" as SessionSection },
  { path: "/ocr", icon: Image, labelKey: "nav.ocr", section: "ocr" as SessionSection },
  { path: "/speak", icon: Volume2, labelKey: "nav.speak", section: "speak" as SessionSection },
];
const adminNavItem = { path: "/admin", icon: Shield, labelKey: "nav.admin", section: null };

type NavItem = { path: string; icon: typeof BookOpen; labelKey: string; section: SessionSection | null };

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
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-muted-foreground hover:text-foreground" aria-label={t("notification.title")}>
          <Bell className="h-[18px] w-[18px]" />
          {unreadCount > 0 && (
            <span className="absolute top-1 end-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(340px,calc(100vw-2rem))] p-0">
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
    {!collapsed && <span>{t(item.labelKey)}</span>}
  </Link>
);

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
        <img src="/favicon.webp" alt="EasyEditor" width={26} height={26} className="rounded flex-shrink-0" />
        {!collapsed && <h1 className="text-lg font-bold text-foreground tracking-tight truncate">EasyEditor</h1>}
      </Link>
      {showCollapseButton && !collapsed && onToggleCollapse && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          className="h-7 w-7"
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
          className="h-7 w-7"
          aria-label={t("sidebar.expand") || "Expand sidebar"}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    )}

    <nav className="flex-shrink-0 space-y-0.5 p-2">
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

    {activeSection && !collapsed && (
      <>
        <div className="border-t border-sidebar-border" />
        <SidebarHistory section={activeSection} collapsed={collapsed} />
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
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
        {/* Mobile Top Bar */}
        <header className="flex h-14 items-center gap-3 border-b border-border px-4 md:hidden bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("sidebar.open") || "Open menu"}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side={direction === "rtl" ? "right" : "left"} className="p-0 w-72 bg-sidebar border-e border-sidebar-border">
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
            <img src="/favicon.webp" alt="EasyEditor" width={24} height={24} className="rounded" />
            <h1 className="text-base font-bold text-foreground truncate">EasyEditor</h1>
          </Link>
          <NotificationBell />
        </header>

        {/* Desktop Top Bar */}
        <div className="hidden md:flex h-14 items-center justify-end border-b border-border px-6 bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <NotificationBell />
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
                    "flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-lg transition-colors min-w-[56px]",
                    isActive ? "text-primary" : "text-muted-foreground active:text-foreground",
                  )}
                >
                  <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                  <span className="text-[10px] font-medium leading-none">{t(item.labelKey)}</span>
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
