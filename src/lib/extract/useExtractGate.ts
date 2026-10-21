import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useCanAfford } from "@/hooks/useTokenBalance";
import { isCapabilityAvailable } from "@/core/capabilities/registry";
import { isDesktop } from "@/utils/environment";
import { ACCEPTED_MEDIA } from "@/lib/audio/formatSupport";
import { ACCEPTED_OCR } from "@/lib/ocr/documentFormats";
import { resolveSttRoute, type SttRoute } from "@/lib/audio/transcribeLongForm";
import type { ExtractGate } from "./engine";

/**
 * What extraction may run here, right now: which kinds exist on this runtime,
 * the speech route (local Whisper or the cloud), and whether the account can
 * pay for a cloud run. Shared by the Extract screen and the editor.
 */
export function useExtractGate(): ExtractGate & { accept: string } {
  const { user } = useAuth();
  const [sttRoute, setSttRoute] = useState<SttRoute>("cloud");
  const { canAfford: canAffordAudio } = useCanAfford("stt", 1);
  const { canAfford: canAffordPage } = useCanAfford("ocr", 1);
  const audioAvailable = isCapabilityAvailable("transcribe");
  const pagesAvailable = isCapabilityAvailable("ocr");

  useEffect(() => {
    let cancelled = false;
    resolveSttRoute()
      .then((r) => !cancelled && setSttRoute(r))
      .catch(() => !cancelled && setSttRoute("cloud"));
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    audioAvailable,
    pagesAvailable,
    signedIn: Boolean(user),
    desktop: isDesktop(),
    sttRoute,
    canAffordAudio,
    canAffordPage,
    accept: [audioAvailable && ACCEPTED_MEDIA, pagesAvailable && ACCEPTED_OCR].filter(Boolean).join(","),
  };
}
