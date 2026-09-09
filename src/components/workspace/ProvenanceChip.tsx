import { useLanguage } from "@/contexts/LanguageContext";
import { CONNECTOR_PROVENANCE_LABEL } from "~shared/agent/connectors";

/**
 * ADR-0038 — the quiet provenance line. When a run's transcript shows a source
 * connector actually returned rows, a small `[ماخذ: باحوث]` chip tells the
 * scholar the answer came from that connector, not a guess. Display-only,
 * derived from `connectorsUsed(toolCalls)`.
 */
export function ProvenanceChips({ connectorIds }: { connectorIds: string[] }) {
  const { t } = useLanguage();
  if (connectorIds.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {connectorIds.map((id) => (
        <span
          key={id}
          className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[0.7rem] leading-none text-muted-foreground"
        >
          <bdi>{t("agent.provenance", "[Source: {name}]").replace("{name}", CONNECTOR_PROVENANCE_LABEL[id] ?? id)}</bdi>
        </span>
      ))}
    </div>
  );
}
