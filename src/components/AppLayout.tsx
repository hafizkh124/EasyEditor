import { useLocation, Link, useNavigate } from "react-router-dom";
import { Home, Mic, Volume2, Image, BookOpen, Settings, Menu, X, Shield, Crown, LogOut } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
        {/* Desktop User Section */}
        <div className="border-t border-border p-4 space-y-3">
          <div className="px-1">
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
          </div>
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
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 start-0 w-64 bg-sidebar border-e border-border z-50">
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
            {/* Mobile User Section */}
            <div className="border-t border-border p-4 space-y-3">
              <div className="px-1">
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
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
          <div className="flex items-center gap-2">
            <img src="/favicon.png" alt="EasyEditor" width={24} height={24} className="rounded" />
            <h1 className="text-lg font-bold text-foreground">EasyEditor</h1>
          </div>
        </header>

        <main className="flex-1 overflow-auto pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="fixed bottom-0 inset-x-0 z-40 flex items-center justify-around border-t border-border bg-background py-2 md:hidden">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                <span>{t(item.labelKey)}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default AppLayout;
