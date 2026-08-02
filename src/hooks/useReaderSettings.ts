import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Phase 3 (SPEC-M6) — Typography & Reading Settings.
 *
 * Reader preferences for the Shamela reader, persisted to localStorage so a
 * user's Arabic reading setup (font, size, line height, theme, column width)
 * survives reloads. Applied to the reader root as inline CSS custom properties
 * consumed by the `.reader-page` stylesheet.
 */

export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderWidth = "narrow" | "normal" | "wide";
export type ReaderDirectionPreference = "auto" | "rtl" | "ltr";

/**
 * Font choices cover all three library languages: Arabic (Naskh/Amiri/Quran),
 * Urdu (Nastaliq) and English/Latin (Lora serif, Work Sans). Every Arabic/Urdu
 * stack ends with a Latin fallback so embedded English words and numerals in
 * an Arabic book render cleanly instead of falling back to the UI font.
 */
export const READER_FONTS = [
  {
    id: "naskh",
    label: "نسخ — Naskh",
    family: '"Noto Naskh Arabic", "Amiri", "Lora", Georgia, serif',
  },
  {
    id: "amiri",
    label: "أميري — Amiri",
    family: '"Amiri", "Noto Naskh Arabic", "Lora", Georgia, serif',
  },
  {
    id: "nastaliq",
    label: "نستعلیق — Nastaliq",
    family: '"Noto Nastaliq Urdu", "Noto Naskh Arabic", "Lora", Georgia, serif',
  },
  {
    id: "quran",
    label: "قرآن — Amiri Quran",
    family: '"Amiri Quran", "Amiri", "Noto Naskh Arabic", "Lora", Georgia, serif',
  },
  {
    id: "vazir",
    label: "وزیرمتن — Vazirmatn",
    family: '"Vazirmatn", "Noto Naskh Arabic", "Work Sans", sans-serif',
  },
  {
    id: "lora",
    label: "English — Lora",
    family: '"Lora", Georgia, "Times New Roman", serif',
  },
  {
    id: "worksans",
    label: "English — Work Sans",
    family: '"Work Sans", "Lora", system-ui, sans-serif',
  },
] as const;

export interface ReaderSettings {
  fontId: string;
  fontSize: number; // px, 14..30
  lineHeight: number; // multiplier, 1.5..2.8
  theme: ReaderTheme;
  width: ReaderWidth;
  /** "auto" detects per page; explicit rtl/ltr overrides. */
  direction: ReaderDirectionPreference;
}

const STORAGE_KEY = "reader.settings.v1";

const DEFAULTS: ReaderSettings = {
  fontId: "naskh",
  fontSize: 18,
  lineHeight: 2.1,
  theme: "light",
  width: "normal",
  direction: "auto",
};

export const READER_THEME_PALETTES: Record<
  ReaderTheme,
  { bg: string; fg: string; muted: string; heading: string; border: string }
> = {
  light: { bg: "#ffffff", fg: "#1a1a1a", muted: "#6b7280", heading: "#0f766e", border: "rgba(0,0,0,0.1)" },
  sepia: { bg: "#f5ecd9", fg: "#3b2f1d", muted: "#8a7a5c", heading: "#9a3412", border: "rgba(90,60,20,0.18)" },
  dark: { bg: "#121212", fg: "#d6d3d1", muted: "#8a8886", heading: "#7dd3fc", border: "rgba(255,255,255,0.12)" },
};

function load(): ReaderSettings {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ReaderSettings>;
    return {
      fontId: typeof parsed.fontId === "string" ? parsed.fontId : DEFAULTS.fontId,
      fontSize: typeof parsed.fontSize === "number" ? clamp(parsed.fontSize, 14, 30) : DEFAULTS.fontSize,
      lineHeight: typeof parsed.lineHeight === "number" ? clamp(parsed.lineHeight, 1.5, 2.8) : DEFAULTS.lineHeight,
      theme: parsed.theme === "dark" || parsed.theme === "sepia" ? parsed.theme : "light",
      width: parsed.width === "narrow" || parsed.width === "wide" ? parsed.width : "normal",
      direction: parsed.direction === "rtl" || parsed.direction === "ltr" ? parsed.direction : "auto",
    };
  } catch {
    return DEFAULTS;
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function fontFamilyFor(fontId: string): string {
  return READER_FONTS.find((f) => f.id === fontId)?.family ?? DEFAULTS.fontId;
}

export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(load);
  // Keep the whole value in a ref so `style` objects stay stable across renders
  // only when the value actually changes.
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota / privacy mode */
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    update(DEFAULTS);
  }, [update]);

  const activeFont = READER_FONTS.find((f) => f.id === settings.fontId) ?? READER_FONTS[0];

  // CSS custom properties applied on the reader root by the caller.
  const palette = READER_THEME_PALETTES[settings.theme];
  const styleProps: Record<string, string> = {
    "--reader-font-family": fontFamilyFor(settings.fontId),
    "--reader-font-size": `${settings.fontSize}px`,
    "--reader-line-height": String(settings.lineHeight),
    "--reader-theme-bg": palette.bg,
    "--reader-theme-fg": palette.fg,
    "--reader-theme-muted": palette.muted,
    "--reader-theme-heading": palette.heading,
    "--reader-theme-border": palette.border,
  };

  return {
    settings,
    update,
    reset,
    activeFont,
    styleProps,
    // convenience getters for toolbar labels
    fontLabel: activeFont.label,
    theme: settings.theme,
    width: settings.width,
    fontSize: settings.fontSize,
    lineHeight: settings.lineHeight,
    direction: settings.direction,
  };
}

export type UseReaderSettings = ReturnType<typeof useReaderSettings>;
