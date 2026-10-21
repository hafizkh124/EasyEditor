import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FolderOpen, MessageSquareText, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CreateSheet } from "@/components/layout/CreateMenu";

/**
 * Mobile tab bar (SYSTEM-2026 §2, nav option 1): two tabs with the "+" create
 * button exactly in the middle — `[ Chat/Write ]  ( + )  [ Files ]`. "Me" is
 * the top-bar avatar (AccountMenu), not a tab.
 *
 * Interim targets until the new Home and Files screens land: Chat/Write opens
 * /dashboard (today's home) and Files opens the workspace library.
 */

interface Tab {
  to: string;
  icon: LucideIcon;
  labelKey: TranslationKey;
  fallback: string;
  isActive: (pathname: string) => boolean;
}

const TABS: [Tab, Tab] = [
  {
    to: "/dashboard",
    icon: MessageSquareText,
    labelKey: "nav.chat_write",
    fallback: "چیٹ/لکھیں",
    isActive: (p) => p === "/dashboard" || p === "/",
  },
  {
    to: "/workspace",
    icon: FolderOpen,
    labelKey: "nav.files",
    fallback: "فائلیں",
    isActive: (p) => p === "/workspace" || p.startsWith("/workspace/"),
  },
];

function TabLink({ tab, pathname }: { tab: Tab; pathname: string }) {
  const { t } = useLanguage();
  const active = tab.isActive(pathname);
  return (
    <Link
      to={tab.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-touch flex-col items-center justify-center gap-1 rounded-lg px-2 py-1.5 transition-colors",
        active ? "text-primary" : "text-muted-foreground active:text-foreground",
      )}
    >
      <tab.icon className="h-6 w-6" aria-hidden="true" />
      <span className={cn("text-xs leading-none", active ? "font-semibold" : "font-medium")}>{t(tab.labelKey, tab.fallback)}</span>
    </Link>
  );
}

export function MobileTabBar() {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [first, second] = TABS;

  return (
    <>
      <nav
        aria-label={t("nav.menu", "مینو")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm md:hidden"
      >
        <div className="grid h-16 grid-cols-[1fr_5.5rem_1fr] items-center px-3">
          <TabLink tab={first} pathname={pathname} />
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            aria-label={t("create.menu_label", "نیا کام شروع کریں")}
            aria-haspopup="dialog"
            aria-expanded={createOpen}
            className={cn(
              "mx-auto -mt-6 flex h-14 w-14 items-center justify-center rounded-2xl border-4 border-background bg-primary text-primary-foreground shadow-lg transition-transform duration-base ease-out-soft active:scale-95",
              createOpen && "rotate-45",
            )}
          >
            <Plus className="h-7 w-7" aria-hidden="true" />
          </button>
          <TabLink tab={second} pathname={pathname} />
        </div>
      </nav>
      <CreateSheet open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

export default MobileTabBar;
