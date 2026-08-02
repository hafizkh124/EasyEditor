import React from "react";
import { Type, Minus, Plus, RotateCcw, Sun, Moon, AlignRight, AlignLeft, ScanText } from "lucide-react";
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

interface ReaderSettingsProps {
  reader: UseReaderSettings;
  triggerClassName?: string;
}

const WIDTH_LABELS: Record<ReaderWidth, string> = {
  narrow: "Narrow",
  normal: "Normal",
  wide: "Wide",
};

const DIRECTION_LABELS: Record<ReaderDirectionPreference, string> = {
  auto: "Auto",
  rtl: "RTL",
  ltr: "LTR",
};

export const ReaderSettings: React.FC<ReaderSettingsProps> = ({ reader, triggerClassName }) => {
  const { settings, update, reset } = reader;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("h-8 w-8", triggerClassName)} title="Reading settings">
          <Type className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <p className="text-xs font-semibold text-foreground">Reading Settings</p>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={reset} title="Reset to defaults">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="p-4 space-y-4">
          {/* Font family */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Font
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
                  {settings.fontId === f.id ? <Type className="h-3 w-3 shrink-0" /> : null}
                  <span className="truncate">{f.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Text size
              </label>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => update({ fontSize: Math.max(14, settings.fontSize - 1) })}
                  disabled={settings.fontSize <= 14}
                  title="Smaller"
                >
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="w-8 text-center text-xs tabular-nums">{settings.fontSize}px</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => update({ fontSize: Math.min(30, settings.fontSize + 1) })}
                  disabled={settings.fontSize >= 30}
                  title="Larger"
                >
                  <Plus className="h-3 w-3" />
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
              <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                Line spacing
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
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Theme
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["light", "sepia", "dark"] as const).map((theme: ReaderTheme) => {
                const palette = READER_THEME_PALETTES[theme];
                return (
                  <button
                    key={theme}
                    type="button"
                    onClick={() => update({ theme })}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      settings.theme === theme
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-input bg-background text-foreground",
                    )}
                  >
                    <span
                      className="flex h-6 w-10 items-center justify-center rounded border border-border/60"
                      style={{ backgroundColor: palette.bg, color: palette.fg }}
                    >
                      {theme === "dark" ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
                    </span>
                    <span className="capitalize">{theme}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text direction — covers Arabic/Urdu (RTL) and English (LTR) books */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Text direction
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["auto", "rtl", "ltr"] as const).map((dir: ReaderDirectionPreference) => (
                <button
                  key={dir}
                  type="button"
                  onClick={() => update({ direction: dir })}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    settings.direction === dir
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-input bg-background text-foreground",
                  )}
                >
                  {dir === "auto" ? (
                    <ScanText className="h-3 w-3 shrink-0" />
                  ) : dir === "rtl" ? (
                    <AlignRight className="h-3 w-3 shrink-0" />
                  ) : (
                    <AlignLeft className="h-3 w-3 shrink-0" />
                  )}
                  {DIRECTION_LABELS[dir]}
                </button>
              ))}
            </div>
          </div>

          {/* Column width */}
          <div className="space-y-2">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Page width
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["narrow", "normal", "wide"] as const).map((w: ReaderWidth) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => update({ width: w })}
                  className={cn(
                    "flex items-center justify-center rounded-md border px-2 py-1.5 text-[11px] transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    settings.width === w
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-input bg-background text-foreground",
                  )}
                >
                  {WIDTH_LABELS[w]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
