import { useCallback, useEffect, useState } from "react";

const KEY = "sidebar.collapsed";

export function useSidebarCollapsed(): [boolean, (v: boolean) => void, () => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(KEY, collapsed ? "1" : "0");
    } catch { /* ignore */ }
  }, [collapsed]);

  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), []);
  const toggle = useCallback(() => setCollapsedState((c) => !c), []);

  return [collapsed, setCollapsed, toggle];
}
