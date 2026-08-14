import { useEffect, useState } from "react";
import { isDesktop } from "@/core/backend";
import { getShamelaClient } from "@/core/shamela/shamelaClient";

export interface ShamelaAvailability {
  /** A Shamela 4 library is actually reachable right now — safe to show
   *  Browse/Search/Favorites/Import rather than tabs that can only ever be empty. */
  available: boolean;
  masterDbPath: string | null;
  checking: boolean;
}

const UNAVAILABLE: ShamelaAvailability = { available: false, masterDbPath: null, checking: false };

/**
 * "Is a Shamela 4 library reachable right now" — the single check that gates
 * BrowseTab, SearchTab, FavoritesTab and the Home-tab import action.
 *
 * Desktop: native IPC detection, unchanged. Web (UX-v1 P7): checks the
 * `tools/shamela-bridge` companion via `shamelaClient`, which is exactly the
 * `localStorage["shamela.connected"]` flow `useLocalShamela` already drives —
 * this hook just also confirms the companion actually responds right now,
 * not merely that it once connected. Only BrowseTab's catalogue is backed by
 * the bridge so far; SearchTab and FavoritesTab remain desktop-only until
 * their own bridge parity lands (SPEC-M5 FR-2.5 — this hook staying `false`
 * for them is what keeps those tabs absent rather than permanently empty).
 */
export function useShamelaAvailability(): ShamelaAvailability {
  const [state, setState] = useState<ShamelaAvailability>({ ...UNAVAILABLE, checking: true });

  useEffect(() => {
    let cancelled = false;

    if (isDesktop()) {
      if (!window.electronAPI?.shamela) {
        setState(UNAVAILABLE);
        return;
      }
      window.electronAPI.shamela
        .detect()
        .then((status) => {
          if (cancelled) return;
          setState({
            available: Boolean(status?.installed && status.masterDbPath),
            masterDbPath: status?.masterDbPath ?? null,
            checking: false,
          });
        })
        .catch(() => {
          if (!cancelled) setState(UNAVAILABLE);
        });
      return () => {
        cancelled = true;
      };
    }

    getShamelaClient()
      .detect()
      .then((result) => {
        if (cancelled) return;
        setState({ available: result.available, masterDbPath: null, checking: false });
      })
      .catch(() => {
        if (!cancelled) setState(UNAVAILABLE);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
