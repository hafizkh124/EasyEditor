import { useCallback, useEffect, useState } from "react";
import { isDesktop } from "@/core/backend";
import type { JkhssnStatus } from "~shared/jkhssn/types";

export interface JkhssnAvailability {
  /** جوامع الكلم is installed AND `jkhssn.sqlite` is built and fresh — safe to
   *  show the مکتبہ → جوامع الكلم tab and expose the axes. */
  available: boolean;
  installed: boolean;
  indexBuilt: boolean;
  indexStale: boolean;
  dataPath: string | null;
  checking: boolean;
  reason?: string;
  /** Re-run detection (after a rebuild). */
  refresh: () => void;
}

const IDLE: Omit<JkhssnAvailability, "refresh"> = {
  available: false, installed: false, indexBuilt: false, indexStale: false,
  dataPath: null, checking: false,
};

/**
 * "Is the جوامع الكلم engine usable right now" (ADR-0045). Desktop-only — the
 * index is a bundled local SQLite file; on web this is always unavailable.
 */
export function useJkhssnAvailability(): JkhssnAvailability {
  const [state, setState] = useState<Omit<JkhssnAvailability, "refresh">>({ ...IDLE, checking: true });

  const check = useCallback(() => {
    if (!isDesktop() || !window.electronAPI?.jkhssn) {
      setState(IDLE);
      return () => {};
    }
    let cancelled = false;
    setState((s) => ({ ...s, checking: true }));
    window.electronAPI.jkhssn
      .detect()
      .then((s: JkhssnStatus) => {
        if (cancelled) return;
        setState({
          available: Boolean(s.installed && s.indexBuilt && !s.indexStale),
          installed: s.installed,
          indexBuilt: s.indexBuilt,
          indexStale: s.indexStale,
          dataPath: s.dataPath,
          checking: false,
          reason: s.reason,
        });
      })
      .catch(() => {
        if (!cancelled) setState(IDLE);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => check(), [check]);

  return { ...state, refresh: check };
}
