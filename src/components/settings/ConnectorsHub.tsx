import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";
import { logger } from "@/lib/logger";
import {
  type Connector, type ConnectorCategory,
} from "~shared/agent/connectors";
import { useConnectorHealth } from "@/hooks/useConnectorHealth";
import { ConnectorCard } from "./ConnectorCard";

const log = logger.child("ConnectorsHub");

const CATEGORY_ORDER: ConnectorCategory[] = [
  "islamic-sciences", "hadith-rijal", "quranic-lexicon", "persian-adab", "urdu-adab", "islamic-finance",
];

/**
 * Connectors Hub (Settings) — a categorised grid of connector cards over the
 * curated registry. The global toggle here = "available on this machine"; the
 * agent composer's `+` popover stays the per-project switch. "Add a connector"
 * only turns on a bundled connector that shipped disabled — no arbitrary URLs.
 *
 * Desktop-only surface (needs `window.electronAPI.connectors`).
 */
export function ConnectorsHub() {
  const { t } = useLanguage();
  const api = typeof window !== "undefined" ? window.electronAPI?.connectors : undefined;

  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [merged, setMerged] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

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

  if (!api?.list) return null;

  const groups = CATEGORY_ORDER
    .map((category) => ({ category, items: connectors.filter((c) => c.category === category) }))
    .filter((g) => g.items.length > 0);

  const disabledConnectors = connectors.filter((c) => !merged[c.id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("connectors.hub.title")}</CardTitle>
        <CardDescription>{t("connectors.hub.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups.map((g) => (
          <section key={g.category} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t(`connectors.category.${g.category}` as TranslationKey)}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.items.map((c) => (
                <ConnectorCard
                  key={c.id}
                  connector={c}
                  enabled={Boolean(merged[c.id])}
                  health={health[c.id]}
                  busy={busyId === c.id}
                  onToggle={(on) => void setEnabled(c.id, on)}
                  onTest={() => refresh(c.id)}
                />
              ))}
            </div>
          </section>
        ))}

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("connectors.hub.add_custom")}
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("connectors.hub.add_custom")}</DialogTitle>
              <DialogDescription>{t("connectors.hub.add_custom_body")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {disabledConnectors.length === 0 && (
                <p className="text-sm text-muted-foreground">—</p>
              )}
              {disabledConnectors.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{c.label}</p>
                    <p className="text-xs text-muted-foreground">{t(c.descriptionKey as TranslationKey)}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === c.id}
                    onClick={() => { void setEnabled(c.id, true); setAddOpen(false); }}
                  >
                    {t("connectors.hub.enable")}
                  </Button>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
