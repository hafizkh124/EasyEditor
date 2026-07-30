import React from "react";
import { useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Mic, ScanText, Volume2, Layers, Languages, User, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";

const TOOLS = [
  { path: "/transcribe", icon: Mic, labelKey: "nav.transcribe", fallback: "ٹرانسکرائب" },
  { path: "/ocr", icon: ScanText, labelKey: "nav.ocr", fallback: "OCR" },
  { path: "/speak", icon: Volume2, labelKey: "nav.speak", fallback: "بولیں" },
  { path: "/extract", icon: Layers, labelKey: "nav.extract", fallback: "استخراج" },
  { path: "/translate", icon: Languages, labelKey: "nav.translate", fallback: "ترجمہ" },
];

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
 */
export const WorkspaceAppMenu: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const label = (key: string, fallback: string) => (t(key) !== key ? t(key) : fallback);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-1.5 shrink-0"
          aria-label={label("nav.menu", "مینو")}
          title={label("nav.menu", "مینو")}
        >
          <img src="/favicon.webp" alt="Easy Editor" width={22} height={22} className="rounded" />
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => navigate("/dashboard")} className="cursor-pointer gap-2">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          {label("nav.dashboard", "ڈیش بورڈ")}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
          {label("nav.tools", "ٹولز")}
        </DropdownMenuLabel>
        {TOOLS.map(({ path, icon: Icon, labelKey, fallback }) => (
          <DropdownMenuItem key={path} onClick={() => navigate(path)} className="cursor-pointer gap-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
            {label(labelKey, fallback)}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/profile")} className="cursor-pointer gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          {label("nav.profile", "میری پروفائل")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
