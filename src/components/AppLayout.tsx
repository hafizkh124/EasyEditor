import { useLocation, Link } from "react-router-dom";
import { Menu } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import ModeBadge from "@/components/ModeBadge";
import { DesktopAccountMenu } from "@/components/auth/DesktopAccountMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { sectionNav, adminNavItem, useActiveSection, type NavItem } from "@/components/layout/appNav";
import { availableCapabilities } from "@/core/capabilities/registry";

/* ─── Main Layout ─── */
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, direction } = useLanguage();
  const { user } = useAuth();
  const { isAdmin } = useApproval();
  const location = useLocation();
  const [collapsed, , toggleCollapsed] = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeSection = useActiveSection();

  const navItems: NavItem[] = isAdmin && adminNavItem ? [...sectionNav, adminNavItem] : sectionNav;

  return (
    <div className="flex min-h-screen bg-background" dir={direction}>
      {/* Skip-to-main link (Phase 6 a11y) — visible only when focused via keyboard. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {t("a11y.skip_to_main", "Skip to main content")}
      </a>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden md:flex md:flex-col border-e border-sidebar-border shrink-0 transition-[width] duration-200",
          collapsed ? "md:w-16" : "md:w-60 lg:w-64",
        )}
      >
        <AppSidebar
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
              <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={t("sidebar.open", "Open menu")}>
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side={direction === "rtl" ? "right" : "left"} className="p-0 w-[min(20rem,85vw)] bg-sidebar border-e border-sidebar-border">
              <AppSidebar
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
          <ThemeToggle />
          <NotificationBell />
        </header>

        {/* Desktop Top Bar */}
        <div className="hidden md:flex h-14 items-center justify-between border-b border-border px-6 bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <div className="flex items-center gap-2">
            <ModeBadge />
          </div>
          <div className="flex items-center gap-2">
            <DesktopAccountMenu />
            <ThemeToggle />
            <NotificationBell />
          </div>
        </div>

        <main id="main-content" className="flex-1 overflow-auto pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile Bottom Navigation. Reads the `mobile-nav` capability surface
            rather than `sectionNav` (the sidebar's list): sidebar entries can
            carry a `children` group — Tools, holding Transcribe/Speak/OCR/etc.
            — which this flat icon row cannot expand. Mapping it directly used
            to send the whole group to `children[0].path`, so tapping "Tools"
            silently landed on Speech-to-Text. Registry capabilities are always
            individually routable, so that shortcut cannot happen here. */}
        <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur-sm md:hidden pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-around h-16">
            {availableCapabilities("mobile-nav").map((capability) => {
              const path = capability.route!;
              const isActive = location.pathname === path || location.pathname.startsWith(path + "/");
              return (
                <Link
                  key={capability.id}
                  to={path}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-lg transition-colors min-w-touch min-h-touch flex-1",
                    isActive ? "text-primary" : "text-muted-foreground active:text-foreground",
                  )}
                >
                  <capability.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                  <span className="text-xs font-medium leading-none">{t(capability.labelKey, capability.fallbackLabel)}</span>
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
