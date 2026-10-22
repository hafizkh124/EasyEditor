import { useMemo, useState } from "react";
import { Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { connectorById } from "~shared/agent/connectors";
import { suggestConnectors } from "~shared/agent/connectorSuggestions";

/** Connectors that send the question to a third-party site — the card says so. */
const SENDS_OUT = new Set(["web", "repositories", "ganjoor"]);

interface ConnectorSuggestionProps {
  /** What the scholar has typed so far. */
  text: string;
  /** Whether the connector is on right now (project override over global). */
  isOn: (id: string) => boolean;
  onEnable: (id: string) => void | Promise<void>;
}

/**
 * ADR-0062 — one line above the composer when the question is about a source
 * that is switched off: "this looks like a question for «Hadith» — turn it on?".
 * Nothing is enabled without a click, and a dismissed connector is not offered
 * again in this chat.
 */
export function ConnectorSuggestion({ text, isOn, onEnable }: ConnectorSuggestionProps) {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  const id = useMemo(() => suggestConnectors(text, isOn, dismissed)[0], [text, isOn, dismissed]);
  const connector = id ? connectorById(id) : undefined;
  if (!id || !connector) return null;

  const enable = async () => {
    setBusy(true);
    try {
      await onEnable(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      className="mx-auto mb-1.5 flex max-w-3xl flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs"
    >
      <Plug className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 text-foreground">
        {t("connectors.suggest.title").replace("{name}", connector.label)}
        {SENDS_OUT.has(id) && (
          <span className="ms-1 text-muted-foreground">{t("connectors.suggest.sends_out")}</span>
        )}
      </span>
      <Button size="sm" className="h-7 min-h-touch md:min-h-0" disabled={busy} onClick={() => void enable()}>
        {t("connectors.suggest.enable")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 min-h-touch md:min-h-0"
        onClick={() => setDismissed((d) => new Set(d).add(id))}
      >
        {t("connectors.suggest.dismiss")}
      </Button>
    </div>
  );
}
