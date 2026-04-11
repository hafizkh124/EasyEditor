import { useLocation, Link, useNavigate } from "react-router-dom";
import { Home, Mic, Volume2, Image, BookOpen, Settings, Menu, X, Shield, Crown, LogOut, Bell, User } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useNotifications } from "@/contexts/NotificationContext";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

const baseNavItems = [
  { path: "/", icon: Home, labelKey: "nav.home" },
  { path: "/transcribe", icon: Mic, labelKey: "nav.transcribe" },
  { path: "/speak", icon: Volume2, labelKey: "nav.speak" },
  { path: "/ocr", icon: Image, labelKey: "nav.ocr" },
  { path: "/research", icon: BookOpen, labelKey: "nav.research" },
  { path: "/pricing", icon: Crown, labelKey: "nav.pricing" },
  { path: "/settings", icon: Settings, labelKey: "nav.settings" },
];

const adminNavItem = { path: "/admin", icon: Shield, labelKey: "nav.admin" };

/* ─── Notification Bell ─── */
const NotificationBell = () => {
  const { t } = useLanguage();
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 text-muted-foreground hover:text-foreground">
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
            <p className="text-sm text-muted-foreground text-center py-8 px-4">
              {t("notification.empty")}
            </p>
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
                    {!n.is_read && (
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                    )}
                    <div className={cn("space-y-0.5", n.is_read && "ms-4")}>
                      <p className="text-sm font-medium text-foreground leading-snug">{n.title}</p>
                      <p className="text-xs text-muted-foreground leading-snug">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground/70">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
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

/* ─── Sidebar Nav Item ─── */
const SidebarNavItem = ({
  item,
  isActive,
  onClick,
  t,
}: {
  item: typeof baseNavItems[0];
  isActive: boolean;
  onClick?: () => void;
  t: (key: string) => string;
}) => (
  <Link
    to={item.path}
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
      isActive
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
    )}
  >
    <item.icon className={cn("h-[18px] w-[18px]", isActive && "text-primary")} />
    {t(item.labelKey)}
  </Link>
);

/* ─── User Section ─── */
const UserSection = ({
  user,
  onNavigate,
  onLogout,
  t,
}: {
  user: { email?: string } | null;
  onNavigate?: () => void;
  onLogout: () => void;
  t: (key: string) => string;
}) => (
  <div className="border-t border-sidebar-border p-4 space-y-1">
    <Link
      to="/profile"
      onClick={onNavigate}
      className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-sidebar-accent/50 transition-colors group"
    >
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <User className="h-4 w-4 text-primary" />
      </div>
      <p className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">
        {user?.email}
      </p>
    </Link>
    <Button
      variant="ghost"
      size="sm"
      onClick={onLogout}
      className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
    >
      <LogOut className="h-4 w-4" />
      {t("settings.logout")}
    </Button>
  </div>
);

/* ─── Main Layout ─── */
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, direction } = useLanguage();
  const { user, signOut } = useAuth();
  const { isAdmin } = useApproval();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await signOut();
    navigate("/login");
  };

  const navItems = isAdmin ? [...baseNavItems, adminNavItem] : baseNavItems;

  // For mobile bottom nav — show only core items (max 5)
  const mobileNavItems = baseNavItems.filter((item) =>
    ["/", "/transcribe", "/ocr", "/research", "/settings"].includes(item.path)
  );

  return (
    <div className="flex min-h-screen bg-background" dir={direction}>
      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex md:w-60 lg:w-64 md:flex-col border-e border-sidebar-border bg-sidebar shrink-0">
        <div className="flex h-14 items-center px-5 border-b border-sidebar-border">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/favicon.png" alt="EasyEditor" width={26} height={26} className="rounded" />
            <h1 className="text-lg font-bold text-foreground tracking-tight">EasyEditor</h1>
          </Link>
        </div>
        <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
          {navItems.map((item) => (
            <SidebarNavItem
              key={item.path}
              item={item}
              isActive={location.pathname === item.path}
              t={t}
            />
          ))}
        </nav>
        <UserSection user={user} onLogout={handleLogout} t={t} />
      </aside>

      {/* ── Mobile Sidebar Overlay ── */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="fixed inset-y-0 start-0 w-72 bg-sidebar border-e border-sidebar-border z-50 flex flex-col shadow-xl">
            <div className="flex h-14 items-center justify-between px-5 border-b border-sidebar-border">
              <Link to="/" className="flex items-center gap-2.5" onClick={() => setSidebarOpen(false)}>
                <img src="/favicon.png" alt="EasyEditor" width={26} height={26} className="rounded" />
                <h1 className="text-lg font-bold text-foreground tracking-tight">EasyEditor</h1>
              </Link>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)} className="h-8 w-8">
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
              {navItems.map((item) => (
                <SidebarNavItem
                  key={item.path}
                  item={item}
                  isActive={location.pathname === item.path}
                  onClick={() => setSidebarOpen(false)}
                  t={t}
                />
              ))}
            </nav>
            <UserSection user={user} onNavigate={() => setSidebarOpen(false)} onLogout={handleLogout} t={t} />
          </aside>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Mobile Top Bar */}
        <header className="flex h-14 items-center gap-3 border-b border-border px-4 md:hidden bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} className="h-9 w-9">
            <Menu className="h-5 w-5" />
          </Button>
          <Link to="/" className="flex items-center gap-2 flex-1 min-w-0">
            <img src="/favicon.png" alt="EasyEditor" width={24} height={24} className="rounded" />
            <h1 className="text-base font-bold text-foreground truncate">EasyEditor</h1>
          </Link>
          <NotificationBell />
        </header>

        {/* Desktop Top Bar */}
        <div className="hidden md:flex h-14 items-center justify-end border-b border-border px-6 bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <NotificationBell />
        </div>

        <main className="flex-1 overflow-auto pb-20 md:pb-6">
          {children}
        </main>

        {/* ── Mobile Bottom Navigation ── */}
        <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm md:hidden pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-around h-16">
            {mobileNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-lg transition-colors min-w-[56px]",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground active:text-foreground"
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
