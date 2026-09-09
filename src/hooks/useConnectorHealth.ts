import { useCallback, useEffect, useRef, useState } from "react";
import { pingConnector, type HealthResult } from "@/lib/connectors/health";

export type HealthMap = Record<string, HealthResult | "checking" | undefined>;

/**
 * Connectors Hub — polls `pingConnector` for a set of connector ids on mount
 * and whenever `ids` changes, plus a manual `refresh(id?)`. A connector that is
 * switched off is not probed (the card shows ⚪ from its own state).
 */
export function useConnectorHealth(enabledIds: string[]): {
  health: HealthMap;
  refresh: (id?: string) => void;
} {
  const [health, setHealth] = useState<HealthMap>({});
  const idsKey = enabledIds.slice().sort().join(",");
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const probe = useCallback(async (id: string) => {
    setHealth((h) => ({ ...h, [id]: "checking" }));
    const r = await pingConnector(id);
    if (mounted.current) setHealth((h) => ({ ...h, [id]: r }));
  }, []);

  const refresh = useCallback((id?: string) => {
    const targets = id ? [id] : idsKey ? idsKey.split(",") : [];
    for (const t of targets) void probe(t);
  }, [idsKey, probe]);

  useEffect(() => {
    for (const id of idsKey ? idsKey.split(",") : []) void probe(id);
  }, [idsKey, probe]);

  return { health, refresh };
}
