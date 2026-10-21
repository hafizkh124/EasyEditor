import { Link } from "react-router-dom";
import { CreditCard, Settings, Shield, User } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { useApproval } from "@/hooks/useApproval";
import { isCapabilityAvailable } from "@/core/capabilities/registry";
import { ThemeToggle } from "@/components/ThemeToggle";
import { adminNavItem } from "@/components/layout/appNav";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * "Me" on mobile (SYSTEM-2026 §2, nav option 1): the account lives in the
 * top-bar avatar instead of a bottom tab, so the tab bar can keep exactly two
 * tabs with the "+" in the middle. Everything that used to be in the mobile
 * drawer's footer and header (profile, plan, settings, theme, admin) is here.
 */
export function AccountMenu() {
  const { t, direction } = useLanguage();
  const { user } = useAuth();
  const { isAdmin } = useApproval();
  const email = user?.email ?? "";
  const initial = email ? email.charAt(0).toUpperCase() : null;
  const showPlan = isCapabilityAvailable("tokens.meter");
  // The admin route comes from the registry (via appNav), never hardcoded:
  // it does not exist on desktop.
  const adminPath = isAdmin ? adminNavItem?.path : undefined;

  return (
    <DropdownMenu dir={direction}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("account.open_menu", "اکاؤنٹ مینو کھولیں")}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {initial ?? <User className="h-4 w-4" aria-hidden="true" />}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-[min(16rem,calc(100vw-2rem))]">
        {email && (
          <>
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">{email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild className="min-h-touch cursor-pointer gap-2">
          <Link to="/profile">
            <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("nav.profile", "پروفائل")}
          </Link>
        </DropdownMenuItem>
        {showPlan && (
          <DropdownMenuItem asChild className="min-h-touch cursor-pointer gap-2">
            <Link to="/pricing">
              <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t("nav.plan_billing", "پلان اور ادائیگی")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild className="min-h-touch cursor-pointer gap-2">
          <Link to="/settings">
            <Settings className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("nav.settings", "ترتیبات")}
          </Link>
        </DropdownMenuItem>
        <ThemeToggle variant="menu" />
        {adminPath && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="min-h-touch cursor-pointer gap-2">
              <Link to={adminPath}>
                <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t("nav.admin", "ایڈمن")}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default AccountMenu;
