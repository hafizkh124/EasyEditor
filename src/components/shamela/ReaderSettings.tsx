import React from "react";
import { Type, Minus, Plus, RotateCcw, Sun, Moon, Monitor, AlignRight, AlignLeft, ScanText } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  READER_FONTS,
  READER_THEME_PALETTES,
  type ReaderTheme,
  type ReaderWidth,
  type ReaderDirectionPreference,
  type UseReaderSettings,
} from "@/hooks/useReaderSettings";
import { useLanguage } from "@/contexts/LanguageContext";
import { type TranslationKey } from "@/lib/i18n";

interface ReaderSettingsProps {
  reader: UseReaderSettings;
  triggerClassName?: string;
}

const WIDTH_LABEL_KEYS: Record<ReaderWidth, TranslationKey> = {
  narrow: "reader.settings.narrow",
  normal: "reader.settings.normal",
  wide: "reader.settings.wide",
};

const DIRECTION_LABEL_KEYS: Record<ReaderDirectionPreference, TranslationKey> = {
  auto: "reader.settings.auto",
  rtl: "reader.settings.rtl",
  ltr: "reader.settings.ltr",
};

const THEME_LABEL_KEYS: Record<ReaderTheme, TranslationKey> = {
  auto: "reader.theme.auto",
  light: "theme.light",
  sepia: "reader.theme.sepia",
  dark: "theme.dark",
};

export const ReaderSettings: React.FC<ReaderSettingsProps> = ({ reader, triggerClassName }) => {
  const { settings, update, reset } = reader;
  const { t } = useLanguage();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("h-8 w-8", triggerClassName)} title={t("reader.settings.title")} aria-label={t("reader.settings.title")}>
          <Type className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[min(20rem,90vw)] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <p className="text-xs font-semibold text-foreground">{t("reader.settings.title")}</p>
          <Button variant="ghost" size="icon" className="h-6 w-6 min-h-touch min-w-touch md:min-h-0 md:min-w-0" onClick={reset} title={t("reader.settings.reset")} aria-label={t("reader.settings.reset")}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {/* Font family */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("reader.settings.font")}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {READER_FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => update({ fontId: f.id })}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    settings.fontId === f.id
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-input bg-background text-foreground",
                  )}
                  style={{ fontFamily: f.family }}
                  title={f.label}
                >
                  {settings.fontId === f.id ? <Type className="h-3.5 w-3.5 shrink-0" /> : null}
                  <span className="truncate">{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("reader.settings.text_size")}
              </label>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
                  onClick={() => update({ fontSize: Math.max(14, settings.fontSize - 1) })}
                  disabled={settings.fontSize <= 14}
                  title={t("reader.settings.smaller")}
                  aria-label={t("reader.settings.smaller")}
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="text-center text-xs tabular-nums">{settings.fontSize} {t("reader.settings.pixels")}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
                  onClick={() => update({ fontSize: Math.min(30, settings.fontSize + 1) })}
                  disabled={settings.fontSize >= 30}
                  title={t("reader.settings.larger")}
                  aria-label={t("reader.settings.larger")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Slider
              value={[settings.fontSize]}
              min={14}
              max={30}
              step={1}
              onValueChange={([v]) => update({ fontSize: v })}
            />
          </div>

          {/* Line height */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {t("reader.settings.line_spacing")}
              </label>
              <span className="text-xs tabular-nums text-muted-foreground">
                {settings.lineHeight.toFixed(2)}
              </span>
            </div>
            <Slider
              value={[settings.lineHeight]}
              min={1.5}
              max={2.8}
              step={0.1}
              onValueChange={([v]) => update({ lineHeight: v })}
            />
          </div>

          <Separator />

          {/* Theme */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("theme.label")}
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(["auto", "light", "sepia", "dark"] as const).map((theme: ReaderTheme) => {
                const palette = theme === "auto" ? null : READER_THEME_PALETTES[theme];
                return (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => update({ theme })}
                    aria-pressed={settings.theme === theme}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      settings.theme === theme
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-input bg-background text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-6 w-10 items-center justify-center rounded border border-border/60",
                        theme === "auto" && "bg-card text-card-foreground",
                      )}
                      style={palette ? { backgroundColor: palette.bg, color: palette.fg } : undefined}
                    >
                      {theme === "auto" ? <Monitor className="h-3.5 w-3.5" /> : theme === "dark" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                    </span>
                    <span>{t(THEME_LABEL_KEYS[theme] as import("@/lib/i18n").TranslationKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text direction — covers Arabic/Urdu (RTL) and English (LTR) books */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("reader.settings.direction")}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["auto", "rtl", "ltr"] as const).map((dir: ReaderDirectionPreference) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => update({ direction: dir })}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    settings.direction === dir
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-input bg-background text-foreground",
                  )}
                >
                  {dir === "auto" ? (
                    <ScanText className="h-3.5 w-3.5 shrink-0" />
                  ) : dir === "rtl" ? (
                    <AlignRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <AlignLeft className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {t(DIRECTION_LABEL_KEYS[dir] as import("@/lib/i18n").TranslationKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Column width */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("reader.settings.page_width")}
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["narrow", "normal", "wide"] as const).map((w: ReaderWidth) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => update({ width: w })}
                  className={cn(
                    "flex items-center justify-center rounded-md border px-2 py-1.5 text-xs transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    settings.width === w
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-input bg-background text-foreground",
                  )}
                >
                  {t(WIDTH_LABEL_KEYS[w] as import("@/lib/i18n").TranslationKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
