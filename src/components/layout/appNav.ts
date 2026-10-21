import type { LucideIcon } from "lucide-react";
import { availableCapabilities, availableCapability } from "@/core/capabilities/registry";
import type { Capability } from "@/core/capabilities/registry";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The sidebar's nav (SYSTEM-2026 §2): Home and Files. The three jobs are behind
 * "+", and settings, profile and admin are in the "Me" menu, so the sidebar
 * has room for the recent list.
 *
 * Which entries exist on this runtime is NOT decided here: the list comes from
 * `@/core/capabilities/registry`, and this module is one of its readers.
 */

export type NavItem = {
  path: string;
  icon: LucideIcon;
  labelKey: TranslationKey;
  fallbackLabel?: string;
};

const toNavItem = (c: Capability): NavItem => ({
  path: c.route!,
  icon: c.icon,
  labelKey: c.labelKey,
  fallbackLabel: c.fallbackLabel,
});

export const sectionNav: NavItem[] = availableCapabilities("sidebar").map(toNavItem);

const adminCapability = availableCapability("admin");
export const adminNavItem: NavItem | null = adminCapability ? toNavItem(adminCapability) : null;
