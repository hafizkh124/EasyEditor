import { useLocation } from "react-router-dom";
import { Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { availableCapabilities } from "@/core/capabilities/registry";
import type { Capability, CapabilityId } from "@/core/capabilities/registry";
import type { TranslationKey } from "@/lib/i18n";
import type { SessionSection } from "@/hooks/useSessionHistory";

/**
 * FR-7 — the sidebar's nav shape: ten items collapsed into three groups, with
 * the standalone tools reached through a "Tools" group rather than each having
 * its own top-level row.
 *
 * Which tools exist on this runtime is NOT decided here. AppLayout used to hold
 * the only honest platform split in the app while every other nav surface kept
 * its own hardcoded copy that drifted out of sync; that list now lives in
 * `@/core/capabilities/registry` and this module is one of its readers.
 */

export type NavChild = {
  path: string;
  icon: LucideIcon;
  labelKey: TranslationKey;
  fallbackLabel?: string;
};

export type NavItem = NavChild & {
  section: SessionSection | null;
  children?: NavChild[];
};

/** Session history is a sidebar concern, so the mapping stays local to it. */
const SECTION_BY_CAPABILITY: Partial<Record<CapabilityId, SessionSection>> = {
  workspace: "editor",
  transcribe: "transcribe",
};

const toNavChild = (c: Capability): NavChild => ({
  path: c.route!,
  icon: c.icon,
  labelKey: c.labelKey,
  fallbackLabel: c.fallbackLabel,
});

const sidebarCapabilities = availableCapabilities("sidebar");
const toolsChildren: NavChild[] = sidebarCapabilities.filter((c) => c.group === "tool").map(toNavChild);
const adminCapability = sidebarCapabilities.find((c) => c.id === "admin");

export const sectionNav: NavItem[] = sidebarCapabilities
  .filter((c) => c.group !== "tool" && c.id !== "admin")
  .flatMap((c) => {
    const item: NavItem = { ...toNavChild(c), section: SECTION_BY_CAPABILITY[c.id] ?? null };
    // The Tools group sits directly under Workspace, and disappears entirely
    // when every tool in it is unavailable — never an empty group.
    if (c.id === "workspace" && toolsChildren.length > 0) {
      return [
        item,
        {
          path: toolsChildren[0].path,
          icon: Wrench,
          labelKey: "nav.tools" as TranslationKey,
          fallbackLabel: "ٹولز (Tools)",
          section: "transcribe" as SessionSection,
          children: toolsChildren,
        },
      ];
    }
    return [item];
  });

export const adminNavItem: NavItem | null = adminCapability
  ? { ...toNavChild(adminCapability), section: null }
  : null;

export function useActiveSection(): SessionSection | null {
  const location = useLocation();
  const found = sectionNav.find((i) => location.pathname.startsWith(i.path));
  return found?.section ?? null;
}
