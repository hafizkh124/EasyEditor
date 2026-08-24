import type { LucideIcon } from "lucide-react";
import {
  BookOpen, Languages, LayoutDashboard, Mic, ScanText, Search,
  Settings as SettingsIcon, Shield, Sparkles, StickyNote, User, Volume2,
} from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { isDesktop } from "@/utils/environment";

/**
 * The single source of truth for "which features exist on which target".
 *
 * SPEC-M5 FR-2.5 says a feature that cannot work must be ABSENT, never a
 * greyed-out button that only ever fails. The rule was honoured in exactly one
 * place — the `desktop?: "always" | "with-local-voice"` field on AppLayout's
 * tool list — while every other nav surface kept its own hardcoded copy of the
 * same five tools. WorkspaceAppMenu and the Dashboard tool grid both offered
 * desktop users routes that redirect back or fail.
 *
 * The fix is structural rather than another round of patches: no surface owns
 * its own list any more, they all ask this module. `capabilityRegistry.test.ts`
 * asserts that no component hardcodes a tool route, so the leak cannot return.
 *
 * This module and `getBackend()` are now the only places allowed to branch on
 * the runtime target (SPEC-M5 §4.3) — it replaces the nav-list branch and the
 * mode badge keeps its own, since it exists purely to name the runtime.
 */

export type Runtime = "web" | "desktop";

/**
 * `reason` is required on `never` on purpose. It is what a developer reads when
 * a capability they expected is missing, and it is the text an empty state can
 * show instead of rendering nothing and looking broken.
 */
export type Availability =
  | { on: "always" }
  | { on: "never"; reason: string }
  | { on: "flag"; flag: "VITE_LOCAL_VOICE" };

export type Surface =
  | "sidebar"
  | "mobile-nav"
  | "workspace-menu"
  | "dashboard-grid"
  | "command-palette"
  | "workbench-tab";

export type CapabilityId =
  | "workspace" | "transcribe" | "ocr" | "speak" | "translate"
  | "research" | "settings" | "dashboard" | "profile" | "admin"
  | "voice.cloning" | "tokens.meter"
  | "wb.aiReader" | "wb.research" | "wb.translate" | "wb.notes";

export interface Capability {
  id: CapabilityId;
  /** `null` for capabilities that are not a page (workbench tabs, cloud-only sub-features). */
  route: string | null;
  labelKey: TranslationKey;
  /** Shown until the locale files carry `labelKey`; see `t(key, fallback)`. */
  fallbackLabel: string;
  icon: LucideIcon;
  runtimes: Record<Runtime, Availability>;
  surfaces: readonly Surface[];
  /**
   * Marks the standalone tools that the sidebar and the workspace menu collapse
   * into a "Tools" group. The group disappears on its own once every member is
   * unavailable, so desktop simply has no Tools entry rather than an empty one.
   */
  group?: "tool";
}

const ALWAYS: Availability = { on: "always" };

/**
 * Local Whisper/Piper/edge-tts (electron/voice/*) cost the user nothing and run
 * entirely offline, so Transcribe and Speak belong on desktop. Their CLOUD
 * halves do not: voice cloning and the token meter both bill our own API, so
 * they stay `never` on desktop and the pages hide those controls.
 *
 * OCR, Translate and Extract have no local counterpart at all — they are paid
 * edge functions end to end — so they remain web-only.
 */
export const CAPABILITIES: readonly Capability[] = [
  {
    id: "workspace", route: "/workspace", labelKey: "nav.workspace", fallbackLabel: "ورک اسپیس",
    icon: BookOpen, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["sidebar", "mobile-nav", "dashboard-grid", "command-palette"],
  },
  {
    id: "transcribe", route: "/transcribe", labelKey: "nav.transcribe", fallbackLabel: "ٹرانسکرائب",
    icon: Mic,
    runtimes: { web: ALWAYS, desktop: { on: "flag", flag: "VITE_LOCAL_VOICE" } },
    surfaces: ["sidebar", "mobile-nav", "workspace-menu", "dashboard-grid", "command-palette"], group: "tool",
  },
  {
    id: "speak", route: "/speak", labelKey: "nav.speak", fallbackLabel: "بولیں",
    icon: Volume2,
    runtimes: { web: ALWAYS, desktop: { on: "flag", flag: "VITE_LOCAL_VOICE" } },
    surfaces: ["sidebar", "workspace-menu", "dashboard-grid", "command-palette"], group: "tool",
  },
  {
    id: "ocr", route: "/ocr", labelKey: "nav.ocr", fallbackLabel: "OCR",
    icon: ScanText,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "OCR runs on a paid cloud edge function with no local counterpart." } },
    surfaces: ["sidebar", "workspace-menu", "dashboard-grid", "command-palette"], group: "tool",
  },
  {
    id: "translate", route: "/translate", labelKey: "nav.translate", fallbackLabel: "ترجمہ",
    icon: Languages,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "Translation runs on a cloud edge function." } },
    surfaces: ["sidebar", "workspace-menu", "command-palette"], group: "tool",
  },
  {
    id: "research", route: "/research", labelKey: "nav.research", fallbackLabel: "تحقیق",
    icon: Search, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["dashboard-grid", "command-palette"],
  },
  {
    id: "settings", route: "/settings", labelKey: "nav.settings", fallbackLabel: "ترتیبات",
    icon: SettingsIcon, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["sidebar", "mobile-nav", "workspace-menu", "command-palette"],
  },
  {
    id: "dashboard", route: "/dashboard", labelKey: "nav.dashboard", fallbackLabel: "ڈیش بورڈ",
    icon: LayoutDashboard, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["mobile-nav", "workspace-menu", "command-palette"],
  },
  {
    id: "profile", route: "/profile", labelKey: "nav.profile", fallbackLabel: "میری پروفائل",
    icon: User, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["workspace-menu"],
  },
  {
    id: "admin", route: "/admin", labelKey: "nav.admin", fallbackLabel: "ایڈمن",
    icon: Shield,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "The admin console administers cloud accounts." } },
    surfaces: ["sidebar"],
  },

  // Cloud-only halves of otherwise-local features. No route and no nav surface:
  // the pages query these to decide whether to render the control at all.
  {
    id: "voice.cloning", route: null, labelKey: "tts.clone_title", fallbackLabel: "آواز کلون کریں",
    icon: Mic,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "Voice cloning bills the ElevenLabs API and needs cloud storage." } },
    surfaces: [],
  },
  {
    id: "tokens.meter", route: null, labelKey: "tokens.tokens", fallbackLabel: "ٹوکنز",
    icon: Sparkles,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "Desktop runs on the user's own BYOK key, so there is no token balance." } },
    surfaces: [],
  },

  // Workbench tabs. Translate and Extract are the same cloud edge functions as
  // their standalone pages, so they disappear on desktop for the same reason.
  {
    id: "wb.aiReader", route: null, labelKey: "workbench.ai_reader", fallbackLabel: "AI Reader",
    icon: Sparkles, runtimes: { web: ALWAYS, desktop: ALWAYS }, surfaces: ["workbench-tab"],
  },
  {
    id: "wb.research", route: null, labelKey: "nav.research", fallbackLabel: "Research",
    icon: Search, runtimes: { web: ALWAYS, desktop: ALWAYS }, surfaces: ["workbench-tab"],
  },
  {
    id: "wb.translate", route: null, labelKey: "nav.translate", fallbackLabel: "Translate",
    icon: Languages,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "Translation runs on a cloud edge function." } },
    surfaces: ["workbench-tab"],
  },
  {
    id: "wb.notes", route: null, labelKey: "workbench.notes", fallbackLabel: "Notes",
    icon: StickyNote, runtimes: { web: ALWAYS, desktop: ALWAYS }, surfaces: ["workbench-tab"],
  },
];

const BY_ID = new Map(CAPABILITIES.map((c) => [c.id, c]));

function currentRuntime(): Runtime {
  return isDesktop() ? "desktop" : "web";
}

/**
 * Written as a static `import.meta.env.VITE_…` reference rather than an index
 * lookup: Vite's `define` is a text substitution, so `import.meta.env[flag]`
 * would never be replaced and the desktop build would silently read undefined.
 * Evaluated per call so tests can `vi.stubEnv` between cases.
 */
function flagEnabled(flag: "VITE_LOCAL_VOICE"): boolean {
  switch (flag) {
    case "VITE_LOCAL_VOICE":
      return import.meta.env.VITE_LOCAL_VOICE === "true";
  }
}

function isAvailable(availability: Availability): boolean {
  switch (availability.on) {
    case "always":
      return true;
    case "never":
      return false;
    case "flag":
      return flagEnabled(availability.flag);
  }
}

export function isCapabilityAvailable(id: CapabilityId): boolean {
  const capability = BY_ID.get(id);
  if (!capability) return false;
  return isAvailable(capability.runtimes[currentRuntime()]);
}

/** Why a capability is missing, for empty states and dev warnings. `null` when it is available. */
export function capabilityUnavailableReason(id: CapabilityId): string | null {
  const availability = BY_ID.get(id)?.runtimes[currentRuntime()];
  if (!availability || isAvailable(availability)) return null;
  return availability.on === "never" ? availability.reason : "Disabled by feature flag.";
}

/** Every capability that belongs on `surface` and is available on this runtime, in registry order. */
export function availableCapabilities(surface: Surface): Capability[] {
  return CAPABILITIES.filter((c) => c.surfaces.includes(surface) && isCapabilityAvailable(c.id));
}
