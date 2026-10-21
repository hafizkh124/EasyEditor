import type { LucideIcon } from "lucide-react";
import {
  BookOpen, Bot, FolderOpen, Home, Languages, Mic, ScanText, Search,
  Settings as SettingsIcon, Shield, Sparkles, User, Volume2,
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
  | "create-menu"
  | "workspace-menu"
  | "dashboard-grid"
  | "command-palette"
  | "workbench-tab";

export type CapabilityId =
  | "workspace" | "extract" | "transcribe" | "ocr" | "speak" | "translate.book"
  | "research" | "settings" | "dashboard" | "files" | "profile" | "admin"
  | "voice.cloning" | "tokens.meter"
  | "wb.aiReader" | "wb.research" | "wb.agent";

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
  /**
   * How the capability reads in the "+" create menu (SYSTEM-2026 §2), where
   * it is phrased as the job ("Audio to text") rather than the tool's name
   * ("Transcribe"). Only read on the `create-menu` surface.
   */
  createLabelKey?: TranslationKey;
  createFallbackLabel?: string;
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
    surfaces: ["dashboard-grid", "command-palette"],
  },
  {
    // The one extract-text screen (SYSTEM-2026 §5) behind both jobs below. It
    // exists wherever either does: on desktop that is the local-voice build,
    // since OCR is cloud-only.
    id: "extract", route: "/extract", labelKey: "extract.title", fallbackLabel: "متن نکالیں",
    icon: ScanText,
    runtimes: { web: ALWAYS, desktop: { on: "flag", flag: "VITE_LOCAL_VOICE" } },
    surfaces: [],
  },
  {
    id: "transcribe", route: "/transcribe", labelKey: "nav.transcribe", fallbackLabel: "ٹرانسکرائب",
    icon: Mic,
    runtimes: { web: ALWAYS, desktop: { on: "flag", flag: "VITE_LOCAL_VOICE" } },
    surfaces: ["create-menu", "workspace-menu", "dashboard-grid", "command-palette"], group: "tool",
    createLabelKey: "create.audio_to_text", createFallbackLabel: "آڈیو سے متن",
  },
  {
    id: "speak", route: "/speak", labelKey: "nav.speak", fallbackLabel: "بولیں",
    icon: Volume2,
    runtimes: { web: ALWAYS, desktop: { on: "flag", flag: "VITE_LOCAL_VOICE" } },
    surfaces: ["workspace-menu", "dashboard-grid", "command-palette"], group: "tool",
  },
  {
    id: "ocr", route: "/ocr", labelKey: "nav.ocr", fallbackLabel: "OCR",
    icon: ScanText,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "OCR runs on a paid cloud edge function with no local counterpart." } },
    surfaces: ["create-menu", "workspace-menu", "dashboard-grid", "command-palette"], group: "tool",
    createLabelKey: "create.image_to_text", createFallbackLabel: "تصویر/PDF سے متن",
  },
  {
    // Book Translation absorbed Quick Translate's text/image/PDF flows (and
    // added a Shamela source) into one full-page destination — the "translate"
    // capability and its sidebar/workbench-tab surfaces were retired with it,
    // so this is the only translate entry point left. Same cloud-only reason
    // for the desktop gate Quick Translate always had.
    id: "translate.book", route: "/translate-book", labelKey: "nav.translate_book", fallbackLabel: "کتاب کا ترجمہ",
    icon: Languages,
    runtimes: { web: ALWAYS, desktop: { on: "never", reason: "Translation runs on a cloud edge function." } },
    surfaces: ["create-menu", "workspace-menu", "dashboard-grid", "command-palette"], group: "tool",
    createLabelKey: "create.translate_book", createFallbackLabel: "کتاب کا ترجمہ",
  },
  {
    id: "research", route: "/research", labelKey: "nav.research", fallbackLabel: "تحقیق",
    icon: Search, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["dashboard-grid", "command-palette"],
  },
  {
    id: "settings", route: "/settings", labelKey: "nav.settings", fallbackLabel: "ترتیبات",
    icon: SettingsIcon, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["workspace-menu", "command-palette"],
  },
  // The sidebar is just Home and Files (SYSTEM-2026 §2): the jobs are behind
  // "+", and settings, profile and admin are in the "Me" menu.
  {
    id: "dashboard", route: "/dashboard", labelKey: "nav.home", fallbackLabel: "ہوم",
    icon: Home, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["sidebar", "workspace-menu", "command-palette"],
  },
  {
    id: "files", route: "/files", labelKey: "nav.files", fallbackLabel: "فائلیں",
    icon: FolderOpen, runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["sidebar", "workspace-menu", "command-palette"],
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
    // Reached from the "Me" menu, which asks `isCapabilityAvailable("admin")`.
    surfaces: [],
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

  // Workbench tabs.
  //
  // M10 Phase 3 §3.6 — this id used to gate a standalone "AI Reader" tab.
  // It now gates "Study", which merges AI Reader + Notes into one tab with
  // an inner segmented control (StudyPanel.tsx) — `wb.notes` was removed as
  // its own capability entirely (it had zero other consumers; grep before
  // removing found only this registration and its old tab-value mapping).
  //
  // `wb.translate` (Quick Translate's tab) was removed the same way once
  // Book Translation absorbed its text/image/PDF flows — grep before
  // removing found only this registration, its TAB_VALUE_BY_CAPABILITY
  // mapping in WorkbenchPanel.tsx, and the "translate" WorkbenchTab literal
  // in usePanelState.ts, all updated together.
  {
    id: "wb.aiReader", route: null, labelKey: "workbench.study", fallbackLabel: "Study",
    icon: Sparkles, runtimes: { web: ALWAYS, desktop: ALWAYS }, surfaces: ["workbench-tab"],
  },
  {
    id: "wb.research", route: null, labelKey: "nav.research", fallbackLabel: "Research",
    icon: Search, runtimes: { web: ALWAYS, desktop: ALWAYS }, surfaces: ["workbench-tab"],
  },
  {
    // SPEC-M8 Layer 6 / ADR-0016; M10 Phase 2.1 (ADR-0034 follow-up) brought
    // the agent to web too — cloud tools only (search/draft/comment/cite),
    // Word/Shamela-bound tools stay desktop-only (shared/agent/toolScoping.ts's
    // NATIVE_ONLY_TOOLS, platform:'web').
    //
    // M11 — the VITE_AGENT_MODE rollout flag is retired. ResearchPanel.tsx no
    // longer has a separate plain-chat fallback UI to fall back to (it was
    // deleted when Ask/Plan/Auto became the only research surface), so a flag
    // that could switch this capability off would leave the app with no
    // research UI at all wherever the flag isn't set (it only ever lived in
    // the uncommitted .env.local on one machine — every other build had it
    // off by default per vite.config.ts's `env.VITE_AGENT_MODE || "false"`).
    id: "wb.agent", route: null, labelKey: "workbench.agent", fallbackLabel: "Agent",
    icon: Bot,
    runtimes: { web: ALWAYS, desktop: ALWAYS },
    surfaces: ["workbench-tab"],
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

/** One capability, or `null` when it does not exist on this runtime. */
export function availableCapability(id: CapabilityId): Capability | null {
  return isCapabilityAvailable(id) ? BY_ID.get(id) ?? null : null;
}
