import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import {
  type Connector, type ConnectorCategory,
} from "~shared/agent/connectors";
import { CONNECTOR_PRESETS, activePresets, presetChanges } from "~shared/agent/connectorPresets";
import { useConnectorHealth } from "@/hooks/useConnectorHealth";
import { ConnectorCard } from "./ConnectorCard";

const log = logger.child("ConnectorsHub");

const CATEGORY_ORDER: ConnectorCategory[] = [
  "islamic-sciences", "hadith-rijal", "quranic-lexicon", "persian-adab", "urdu-adab", "islamic-finance",
];

/**
 * Connectors Hub (Settings) over the curated registry. The global toggle here
 * = "available on this machine"; the agent composer's `+` popover stays the
 * per-project switch.
 *
 * ADR-0062: topic presets on top, "My connectors" (what is on) below, a Library
 * of what is not, and the Shamela transports under a collapsed Advanced
 * section (Turath already covers every device). Adding from the Library only
 * turns on a bundled connector — no arbitrary URLs.
 *
 * Desktop-only surface (needs `window.electronAPI.connectors`).
 */
export function ConnectorsHub() {
  const { t } = useLanguage();
  const api = typeof window !== "undefined" ? window.electronAPI?.connectors : undefined;

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [merged, setMerged] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const load = useCallback(async () => {
    if (!api?.list) return;
    try {
      const r = await api.list();
      setConnectors(r.connectors);
      setMerged(r.merged);
    } catch (err) {
      log.warn("connectors.list failed", { err });
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const enabledIds = useMemo(
    () => connectors.filter((c) => merged[c.id]).map((c) => c.id),
    [connectors, merged],
  );
  const { health, refresh } = useConnectorHealth(enabledIds);

  const setEnabled = useCallback(async (id: string, on: boolean) => {
    if (!api?.setEnabled) return;
    setBusyId(id);
    setMerged((m) => ({ ...m, [id]: on }));
    try {
      await api.setEnabled(id, on, "global");
      await load();
      if (on) refresh(id);
    } catch (err) {
      log.warn("connectors.setEnabled failed", { err });
      void load();
    } finally {
      setBusyId(null);
    }
  }, [api, load, refresh]);

  // Additive: turns the preset's members on, touches nothing else (ADR-0062).
  const applyPreset = useCallback(async (presetId: string) => {
    const preset = CONNECTOR_PRESETS.find((p) => p.id === presetId);
    if (!preset || !api?.setEnabled) return;
    for (const id of presetChanges(preset, merged)) {
      if (connectors.some((c) => c.id === id)) await setEnabled(id, true);
    }
  }, [api, connectors, merged, setEnabled]);

  if (!api?.list) return null;

  const active = new Set(activePresets(merged));
  const mine = connectors.filter((c) => merged[c.id] && !c.advanced);
  const library = connectors.filter((c) => !merged[c.id] && !c.advanced);
  const advanced = connectors.filter((c) => c.advanced);

  const groups = CATEGORY_ORDER
    .map((category) => ({ category, items: mine.filter((c) => c.category === category) }))
    .filter((g) => g.items.length > 0);

  const card = (c: Connector) => (
    <ConnectorCard
      key={c.id}
      connector={c}
      enabled={Boolean(merged[c.id])}
      health={health[c.id]}
      busy={busyId === c.id}
      onToggle={(on) => void setEnabled(c.id, on)}
      onTest={() => refresh(c.id)}
    />
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("connectors.hub.title")}</CardTitle>
        <CardDescription>{t("connectors.hub.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <section className="space-y-2" aria-label={t("connectors.hub.presets")}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("connectors.hub.presets")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("connectors.hub.presets_hint")}</p>
          <div className="flex flex-wrap gap-2">
            {CONNECTOR_PRESETS.map((p) => {
              const on = active.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  title={t(p.descriptionKey as TranslationKey)}
                  onClick={() => void applyPreset(p.id)}
                  className={cn(
                    "inline-flex min-h-touch items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm md:min-h-0",
                    on
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                  {t(p.labelKey as TranslationKey)}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3" aria-label={t("connectors.hub.mine")}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("connectors.hub.mine")} ({mine.length})
          </h3>
          {groups.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("connectors.hub.mine_empty")}</p>
          )}
          {groups.map((g) => (
            <div key={g.category} className="space-y-2">
              <h4 className="text-xs text-muted-foreground">
                {t(`connectors.category.${g.category}` as TranslationKey)}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">{g.items.map(card)}</div>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <button
            type="button"
            aria-expanded={libraryOpen}
            onClick={() => setLibraryOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4" aria-hidden />
              {t("connectors.hub.library")} ({library.length})
            </span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", libraryOpen && "rotate-180")} aria-hidden />
          </button>
          {libraryOpen && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t("connectors.hub.library_hint")}</p>
              {library.length === 0 && <p className="text-sm text-muted-foreground">—</p>}
              {library.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{t(c.descriptionKey as TranslationKey)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === c.id}
                    onClick={() => void setEnabled(c.id, true)}
                  >
                    {t("connectors.hub.enable")}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        {advanced.length > 0 && (
          <section className="space-y-2">
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm text-muted-foreground hover:text-foreground"
            >
              <span>{t("connectors.hub.advanced")}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", advancedOpen && "rotate-180")} aria-hidden />
            </button>
            {advancedOpen && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("connectors.hub.advanced_hint")}</p>
                <div className="grid gap-2 sm:grid-cols-2">{advanced.map(card)}</div>
              </div>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
