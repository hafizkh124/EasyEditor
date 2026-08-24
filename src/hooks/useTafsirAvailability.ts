import { useEffect, useState } from "react";
import { tafsirPing } from "@/lib/tafsir/tafsirService";

export interface TafsirAvailability {
  /** Tafsir MCP is actually reachable right now — remote mode always, since
   *  that is the only mode ever offered outside the desktop connect panel
   *  (local/stdio stays a Settings-only, desktop-only path per SPEC-TAFSIR's
   *  Non-Goals). Gates the editor's Tafsir search leg and its chip's
   *  enabled/disabled state. */
  available: boolean;
  checking: boolean;
}

const UNAVAILABLE: TafsirAvailability = { available: false, checking: false };

/**
 * "Is Tafsir MCP reachable right now" — there was no such hook before this:
 * `TafsirConnector.tsx` used to own connection state locally and threw it
 * away on unmount (`onConnectedChange={() => {}}`), so nothing else in the
 * app could ask. Mirrors `useShamelaAvailability`'s shape: probe once on
 * mount, no polling — a stale "available" is caught by the search call
 * itself failing, same as Shamela's own safe-wrapper pattern.
 */
export function useTafsirAvailability(): TafsirAvailability {
  const [state, setState] = useState<TafsirAvailability>({ available: false, checking: true });

  useEffect(() => {
    let cancelled = false;
    tafsirPing("remote")
      .then((result) => {
        if (!cancelled) setState({ available: result.ok, checking: false });
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
