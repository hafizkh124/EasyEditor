import React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Keyboard } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { isDesktop } from "@/core/backend";
import { JkhssnConnectPanel } from "@/components/jkhssn/JkhssnConnectPanel";
import { KnowledgeGraphTab } from "@/components/workspace/KnowledgeGraphTab";
import { RecipesTab } from "@/components/workspace/RecipesTab";
import { WORKSPACE_SHORTCUTS } from "@/core/workspace/shortcuts";

/**
 * Plan §3.1 — the ⚙️ ترتیبات rail panel. Collects the low-traffic surfaces that
 * used to be Library tabs (Knowledge Graph, Recipes) plus the connectors
 * summary, the JKHSSN connect panel, and the keyboard-shortcut reference.
 */

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">{title}</h3>
    {children}
  </section>
);

export const WorkspaceSettingsPanel: React.FC = () => {
  const { t } = useLanguage();
  const graphEnabled = import.meta.env.VITE_KNOWLEDGE_GRAPH !== "false";
  const recipesEnabled = import.meta.env.VITE_RECIPES !== "false";

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 border-b border-sidebar-border px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide">{t("rail.settings", "ترتیبات")}</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-5 p-3">
          <Section title={t("settings.connectors", "کنیکٹرز")}>
            <Button asChild variant="outline" size="sm" className="h-8 w-full justify-between text-xs">
              <Link to="/settings#connectors">
                {t("settings.open_connectors_hub", "کنیکٹرز ہب کھولیں")}
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </Section>

          {isDesktop() && (
            <Section title={t("jkhssn.title", "جوامع الكلم")}>
              <JkhssnConnectPanel />
            </Section>
          )}

          <Section title={t("workspace.shortcuts", "کی بورڈ شارٹ کٹس")}>
            <ul className="space-y-1">
              {WORKSPACE_SHORTCUTS.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Keyboard className="h-3.5 w-3.5" />
                    {t(s.labelKey as never, s.labelFallback)}
                  </span>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
                </li>
              ))}
            </ul>
          </Section>

          {graphEnabled && (
            <Section title={t("library.tab_graph", "Graph")}>
              <div className="rounded-md border border-sidebar-border">
                <KnowledgeGraphTab />
              </div>
            </Section>
          )}

          {recipesEnabled && (
            <Section title={t("library.tab_recipes", "Recipes")}>
              <div className="rounded-md border border-sidebar-border">
                <RecipesTab />
              </div>
            </Section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
