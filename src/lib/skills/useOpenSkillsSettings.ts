import { useCallback, useContext } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

/** Where "Manage skills" goes, from the end of every `/` menu (SYSTEM-2026 §15.3). */
export const SKILLS_SETTINGS_PATH = "/settings?section=skills";

/**
 * Opens Settings → Skills. Reads the navigator from context rather than
 * `useNavigate()`, so the menus still render (without the link doing anything)
 * when they are mounted outside a router, as in their unit tests.
 */
export function useOpenSkillsSettings(): (() => void) | null {
  const navigator = useContext(UNSAFE_NavigationContext)?.navigator;
  const open = useCallback(() => navigator?.push(SKILLS_SETTINGS_PATH), [navigator]);
  return navigator ? open : null;
}
