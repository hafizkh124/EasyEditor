import { useLocation, Link } from "react-router-dom";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { cn } from "@/lib/utils";
import SubscriptionBanner from "@/components/SubscriptionBanner";
import ModeBadge from "@/components/ModeBadge";
import { DesktopAccountMenu } from "@/components/auth/DesktopAccountMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { sectionNav, adminNavItem, useActiveSection, type NavItem } from "@/components/layout/appNav";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { CreateMenuButton } from "@/components/layout/CreateMenu";
import { MobileTabBar } from "@/components/layout/MobileTabBar";

/* ─── Main Layout ─── */
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t, direction } = useLanguage();
  const { user } = useAuth();
  const { isAdmin } = useApproval();
  const location = useLocation();
  const [collapsed, , toggleCollapsed] = useSidebarCollapsed();
  const activeSection = useActiveSection();

  const navItems: NavItem[] = isAdmin && adminNavItem ? [...sectionNav, adminNavItem] : sectionNav;

  return (
    <div className="flex min-h-screen bg-background app-shell" dir={direction}>
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
          createSlot={<CreateMenuButton collapsed={collapsed} />}
        />
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col min-w-0">
        <SubscriptionBanner />
        {/* Mobile Top Bar (SYSTEM-2026 §2, nav option 1). The old hamburger
            drawer is gone: tools are in the tab bar's "+" sheet, and profile,
            plan, settings, theme and admin are in the avatar menu. */}
        <header className="flex h-14 items-center gap-2 border-b border-border px-4 md:hidden bg-background/95 backdrop-blur-sm sticky top-0 z-30">
          <Link to="/" className="flex items-center gap-2 flex-1 min-w-0">
            <img src={`${import.meta.env.BASE_URL}favicon.webp`} alt="Easy Editor" width={24} height={24} className="rounded" />
            <span className="text-base font-bold text-foreground truncate">Easy Editor</span>
          </Link>
          <DesktopAccountMenu />
          <NotificationBell />
          <AccountMenu />
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

        <MobileTabBar />
      </div>
    </div>
  );
};

export default AppLayout;
