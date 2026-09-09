import { LocalShamelaConnector } from "@/components/mcp/LocalShamelaConnector";
import { ShamelaCloudPanel } from "@/components/shamela/ShamelaCloudPanel";
import { useLanguage } from "@/contexts/LanguageContext";
import { isDesktop } from "@/utils/environment";

/**
 * ADR-0044 — the two Shamela transports paired under one heading: the local
 * library + the online شامله لنک library. `ShamelaCloudPanel` renders null on
 * web, so this degrades to just the (bridge) local connector there.
 */
export function ShamelaConnectors() {
  const { t, direction } = useLanguage();
  return (
    <div className="space-y-3" dir={direction}>
      {isDesktop() && (
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("shamelaCloud.section.title", "Maktaba Shamela")}</h2>
          <p className="text-xs text-muted-foreground">{t("shamelaCloud.section.subtitle", "")}</p>
        </div>
      )}
      <LocalShamelaConnector />
      <ShamelaCloudPanel />
    </div>
  );
}
