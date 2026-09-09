import type { LucideIcon } from "lucide-react";
import {
  LibraryBig, BookOpenText, ScrollText, Globe, Database,
  Scale, Network, BookA, Feather, Music2, Users, Plug, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Translator, TranslationKey } from "@/lib/i18n";
import type { Connector } from "~shared/agent/connectors";
import type { HealthResult } from "@/lib/connectors/health";

/** Keeps `shared/agent/connectors.ts` free of React — icon names resolve here. */
const ICONS: Record<string, LucideIcon> = {
  "library-big": LibraryBig,
  "book-open-text": BookOpenText,
  "scroll-text": ScrollText,
  globe: Globe,
  database: Database,
  scale: Scale,
  network: Network,
  "book-a": BookA,
  feather: Feather,
  "music-2": Music2,
  users: Users,
};

type Health = HealthResult | "checking" | undefined;

interface StatusView {
  dot: string;
  tone: string;
  label: string;
  hint?: string;
}

function statusView(enabled: boolean, health: Health, t: Translator): StatusView {
  if (!enabled) return { dot: "⚪", tone: "text-muted-foreground", label: t("connectors.status.disabled") };
  if (health === "checking") return { dot: "⏳", tone: "text-muted-foreground", label: t("connectors.status.checking") };
  if (!health) return { dot: "•", tone: "text-muted-foreground", label: "—" };
  if (health.ok === true) {
    const ms = typeof health.latencyMs === "number" && health.latencyMs > 0 ? ` · ${health.latencyMs}ms` : "";
    return { dot: "🟢", tone: "text-emerald-600 dark:text-emerald-400", label: t("connectors.status.connected") + ms };
  }
  if (health.ok === false) {
    return { dot: "🔴", tone: "text-red-600 dark:text-red-400", label: t("connectors.status.error"), hint: health.detail };
  }
  return { dot: "⚪", tone: "text-muted-foreground", label: t("connectors.status.unknown"), hint: health.detail };
}

export function ConnectorCard({
  connector, enabled, health, busy, onToggle, onTest,
}: {
  connector: Connector;
  enabled: boolean;
  health: Health;
  busy?: boolean;
  onToggle: (on: boolean) => void;
  onTest: () => void;
}) {
  const { t } = useLanguage();
  const Icon = ICONS[connector.icon] ?? Plug;
  const s = statusView(enabled, health, t);
  const pingable = enabled && connector.healthKind !== "compute" && connector.healthKind !== "bridged";

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-md bg-primary/10 p-1.5 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{connector.label}</span>
            {busy && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t(connector.descriptionKey as TranslationKey)}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={busy}
          aria-label={connector.label}
          className="shrink-0"
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 ps-9">
        <span className={cn("flex items-center gap-1.5 text-xs", s.tone)} title={s.hint}>
          <span aria-hidden>{s.dot}</span>
          <span>{s.label}</span>
        </span>
        {pingable && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={onTest}
            disabled={health === "checking"}
          >
            {t("connectors.hub.test_ping")}
          </Button>
        )}
      </div>
      {s.hint && s.dot === "🔴" && (
        <p className="mt-1 ps-9 text-xs text-red-600 dark:text-red-400">{s.hint}</p>
      )}
    </div>
  );
}
