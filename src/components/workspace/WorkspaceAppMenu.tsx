import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { availableCapabilities } from "@/core/capabilities/registry";

/**
 * The way out of the workspace.
 *
 * WorkspaceLayout deliberately does not use AppLayout — its sidebar would
 * collide with the Library pillar and make a fourth column (SPEC-M2 FR-1.4).
 * But nothing replaced the navigation that sidebar carried, and the TopBar
 * spec (FR-5.3) never listed one, so on desktop a user who opened
 * /workspace had no route to the dashboard, the tools, or their profile:
 * the only back button is mobile-only, and Ctrl+K offers workspace-internal
 * actions only. This menu is that missing exit.
 *
 * The entries come from the capability registry rather than a local list. This
 * component used to hardcode all five tools while AppLayout correctly stripped
 * three of them on desktop, so the one menu a desktop user could actually reach
 * was the one offering routes that redirect straight back here.
 */
export const WorkspaceAppMenu: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const menuCapabilities = availableCapabilities("workspace-menu");
  const tools = menuCapabilities.filter((c) => c.group === "tool");
  const primary = menuCapabilities.filter((c) => c.group !== "tool");
  const entryFor = (id: string) => primary.find((c) => c.id === id);
  const dashboard = entryFor("dashboard");
  const settings = entryFor("settings");
  const profile = entryFor("profile");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-1.5 shrink-0"
          aria-label={t("nav.menu", "مینو")}
          title={t("nav.menu", "مینو")}
        >
          <img src={`${import.meta.env.BASE_URL}favicon.webp`} alt="Easy Editor" width={22} height={22} className="rounded" />
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        {dashboard && (
          <DropdownMenuItem onClick={() => navigate(dashboard.route!)} className="cursor-pointer gap-2">
            <dashboard.icon className="h-4 w-4 text-primary" />
            {t(dashboard.labelKey, dashboard.fallbackLabel)}
          </DropdownMenuItem>
        )}

        {/* Absent, never disabled: on desktop every tool here is cloud-only, so
            the heading goes with them rather than labelling an empty list. */}
        {tools.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
              {t("nav.tools", "ٹولز")}
            </DropdownMenuLabel>
            {tools.map((tool) => (
              <DropdownMenuItem key={tool.id} onClick={() => navigate(tool.route!)} className="cursor-pointer gap-2">
                <tool.icon className="h-4 w-4 text-muted-foreground" />
                {t(tool.labelKey, tool.fallbackLabel)}
              </DropdownMenuItem>
            ))}
          </>
        )}

        <DropdownMenuSeparator />
        {settings && (
          <DropdownMenuItem onClick={() => navigate(settings.route!)} className="cursor-pointer gap-2">
            <settings.icon className="h-4 w-4 text-muted-foreground" />
            {t(settings.labelKey, settings.fallbackLabel)}
          </DropdownMenuItem>
        )}
        <ThemeToggle variant="menu" />
        {profile && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate(profile.route!)} className="cursor-pointer gap-2">
              <profile.icon className="h-4 w-4 text-muted-foreground" />
              {t(profile.labelKey, profile.fallbackLabel)}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
