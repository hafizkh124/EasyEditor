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

const NotificationBell = () => {
  const { t } = useLanguage();
  const { notifications, unreadCount, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = useState(false);

  const handleOpen = (val: boolean) => {
    setOpen(val);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8 text-muted-foreground hover:text-foreground">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(320px,calc(100vw-2rem))] p-0">
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

  const UserSection = ({ onNavigate }: { onNavigate?: () => void }) => (
    <div className="border-t border-border p-4 space-y-2">
      <Link
        to="/profile"
        onClick={onNavigate}
        className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-sidebar-accent/50 transition-colors group"
      >
        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="h-4 w-4 text-primary" />
        </div>
        <p className="text-xs text-muted-foreground truncate group-hover:text-foreground transition-colors">
          {user?.email}
        </p>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleLogout}
        className="w-full justify-start gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      >
        <LogOut className="h-4 w-4" />
        {t("settings.logout")}
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background" dir={direction}>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col border-e border-border bg-sidebar">
        <div className="flex h-16 items-center px-6 border-b border-border">
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="EasyEditor" width={28} height={28} className="rounded" />
            <h1 className="text-xl font-bold text-foreground">EasyEditor</h1>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <item.icon className="h-5 w-5" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
        <UserSection />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 start-0 w-64 bg-sidebar border-e border-border z-50 flex flex-col">
            <div className="flex h-16 items-center justify-between px-6 border-b border-border">
              <div className="flex items-center gap-2">
                <img src="/favicon.png" alt="EasyEditor" width={28} height={28} className="rounded" />
                <h1 className="text-xl font-bold text-foreground">EasyEditor</h1>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <nav className="flex-1 space-y-1 p-4">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {t(item.labelKey)}
                  </Link>
                );
              })}
            </nav>
            <UserSection onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 flex-col">
        {/* Mobile Top Bar */}
        <header className="flex h-14 items-center gap-4 border-b border-border px-4 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2 flex-1">
            <img src="/favicon.png" alt="EasyEditor" width={24} height={24} className="rounded" />
            <h1 className="text-lg font-bold text-foreground">EasyEditor</h1>
          </div>
          <NotificationBell />
        </header>

        {/* Desktop Top Bar (notification bell only) */}
        <div className="hidden md:flex h-14 items-center justify-end border-b border-border px-6">
          <NotificationBell />
        </div>

        <main className="flex-1 overflow-auto pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="fixed bottom-0 inset-x-0 z-40 flex items-center border-t border-border bg-background md:hidden overflow-x-auto scrollbar-none">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium transition-colors flex-shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="hidden xs:inline">{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default AppLayout;
