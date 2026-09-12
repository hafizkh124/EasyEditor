import { BookOpen, PenLine, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/lib/i18n";
import {
  connectorsByCategory, CONNECTOR_PROVENANCE_LABEL, connectorForTool,
} from "~shared/agent/connectors";
import { AGENT_TOOLS } from "~shared/agent/toolSchemas";
import { PRINT_LAYOUT_LOSS } from "~shared/print/trimSizes";

/**
 * M11 Phase 3 / M12 Phase H — the real Methods page (a placeholder
 * ["Full methods page coming in a future update."] before this). Explains,
 * for a scholar who wants to trust the agent's answers, where its sources
 * come from, what it can and cannot do, and what a "print-ready" export
 * does not give them.
 *
 * Every section is DERIVED directly from the same closed registries the
 * agent itself runs on (`CONNECTORS`, `AGENT_TOOLS`, `CONNECTOR_PROVENANCE_LABEL`,
 * `PRINT_LAYOUT_LOSS`) — never a hand-typed second copy of "what the agent
 * does" that could quietly drift from what it actually does.
 * `methodsPanel.test.tsx` renders this and checks every registry entry is
 * actually represented, so that drift would fail a test, not just go unnoticed.
 */

/** The tool's own description up to its first sentence — the full text is often several sentences of "do not use for…" guidance not needed here. */
function firstSentence(desc: string): string {
  const m = /^(.*?[.!?])(\s|$)/.exec(desc);
  return (m ? m[1] : desc).trim();
}

export function MethodsPanel() {
  const { t } = useLanguage();
  const groups = connectorsByCategory();
  const ownedToolNames = new Set(AGENT_TOOLS.filter((tool) => connectorForTool(tool.name) !== null).map((tool) => tool.name));
  const generalTools = AGENT_TOOLS.filter((tool) => !ownedToolNames.has(tool.name));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {t("methods.title", "Research Methods")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t("methods.intro", "How the agent finds, grades, and cites its sources — grouped by the same connectors you switch on and off in Settings → Connectors.")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            {t("methods.sources_title", "Sources and connectors")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {groups.map((g) => (
            <div key={g.category} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`connectors.category.${g.category}` as TranslationKey)}
              </h3>
              {g.connectors.map((c) => {
                const tools = AGENT_TOOLS.filter((tool) => connectorForTool(tool.name) === c.id);
                return (
                  <div key={c.id} className="rounded-md border border-border p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{c.label}</span>
                      <span className="text-[0.65rem] rounded-full border border-border bg-muted px-1.5 py-0.5 text-muted-foreground">
                        {CONNECTOR_PROVENANCE_LABEL[c.id] ?? c.id}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">{t(c.descriptionKey as TranslationKey)}</p>
                    {tools.length > 0 && (
                      <ul className="text-[0.7rem] text-muted-foreground/80 ms-3 list-disc space-y-0.5">
                        {tools.map((tool) => (
                          <li key={tool.name}>
                            <code className="text-foreground/80">{tool.name}</code>
                            {" — "}
                            {firstSentence(tool.description)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PenLine className="h-4 w-4 text-primary" />
            {t("methods.tools_title", "Other things the agent can do")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-muted-foreground space-y-1">
            {generalTools.map((tool) => (
              <li key={tool.name}>
                <code className="text-foreground/80">{tool.name}</code>
                {" — "}
                {firstSentence(tool.description)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("methods.print_limits_title", "What a print-ready export does not give you")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="text-xs text-muted-foreground list-disc ms-4 space-y-1">
            {PRINT_LAYOUT_LOSS.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
