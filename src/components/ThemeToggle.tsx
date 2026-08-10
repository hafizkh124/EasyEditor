import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { isAppTheme, type AppTheme } from "@/lib/theme";

type ThemeToggleVariant = "icon" | "menu" | "settings";

interface ThemeToggleProps {
  variant?: ThemeToggleVariant;
  className?: string;
}

const THEME_OPTIONS = [
  { value: "light", labelKey: "theme.light", icon: Sun },
  { value: "dark", labelKey: "theme.dark", icon: Moon },
  { value: "system", labelKey: "theme.system", icon: Monitor },
] as const;

export function ThemeToggle({ variant = "icon", className }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { t } = useLanguage();
  const selected: AppTheme = isAppTheme(theme) ? theme : "system";
  const TriggerIcon = selected === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  const selectTheme = (value: string) => {
    if (isAppTheme(value)) setTheme(value);
  };

  const radioItems = THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
    <DropdownMenuRadioItem
      key={value}
      value={value}
      className="min-h-touch cursor-pointer gap-2 pe-8"
    >
      <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      <span className="flex-1">{t(labelKey as import("@/lib/i18n").TranslationKey)}</span>
    </DropdownMenuRadioItem>
  ));

  if (variant === "menu") {
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={cn("min-h-touch cursor-pointer gap-2", className)}>
          <TriggerIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1">{t("theme.label")}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-44">
          <DropdownMenuRadioGroup value={selected} onValueChange={selectTheme}>
            {radioItems}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  }

  if (variant === "settings") {
    return (
      <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-3", className)} role="radiogroup" aria-label={t("theme.label")}>
        {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => {
          const active = selected === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(value)}
              className={cn(
                "min-h-touch rounded-lg border px-3 py-3 text-sm transition-colors",
                "flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(labelKey as import("@/lib/i18n").TranslationKey)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("min-h-touch min-w-touch text-muted-foreground hover:text-foreground", className)}
          aria-label={t("theme.label")}
          title={t("theme.label")}
        >
          <TriggerIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup value={selected} onValueChange={selectTheme}>
          {radioItems}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
