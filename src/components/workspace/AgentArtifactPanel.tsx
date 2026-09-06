/**
 * M9 ADR-0024 — the live artifact surface.
 *
 * Renders what the agent is producing as it produces it: a chapter draft, a
 * comparison table, a running citation list, the proposed plan. Fed by
 * `kind: 'artifact'` events on the AGENT_PROGRESS channel.
 *
 * Phase 0 ships this inline in the Agent panel; the resizable chat/artifact
 * split (Phase 1b) reuses the same component.
 */
import React from "react";
import { FileText, Table2, ListChecks, ListTree, GitCompare, Captions, ClipboardList, ExternalLink } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import type { AgentArtifactType } from "../../../shared/agent/types";
import type { ArtifactState } from "./agentArtifactState";

const ICON: Record<AgentArtifactType, React.ComponentType<{ className?: string }>> = {
  document: FileText,
  table: Table2,
  comparison: GitCompare,
  "citation-list": ListChecks,
  outline: ListTree,
  index: ListTree,
  transcript: Captions,
  plan: ClipboardList,
};

const AgentArtifactPanel: React.FC<{ artifacts: ArtifactState[] }> = ({ artifacts }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      {artifacts.map((a) => {
        const Icon = ICON[a.type] ?? FileText;
        return (
          <div key={a.id} className="rounded-md border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-1.5 border-b border-border bg-muted px-2 py-1 text-xs font-medium">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{a.title}</span>
              {a.status !== "open" && (
                <span className={`ms-auto rounded px-1 text-xs ${a.status === "final" ? "text-emerald-600" : "text-amber-600"}`}>
                  {a.status}
                </span>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto p-2 text-xs">
              {a.table ? (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>{a.table.columns.map((c, i) => <th key={i} className="border border-border px-1 py-0.5 text-start font-medium">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {a.table.rows.map((r, i) => (
                      <tr key={i}>{r.map((cell, j) => <td key={j} className="border border-border px-1 py-0.5 align-top">{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              ) : a.citations ? (
                <ul className="space-y-1">
                  {a.citations.map((c, i) => {
                    const head = (
                      <>
                        <span className="font-mono text-muted-foreground">{c.marker}</span>
                        <span className="flex-1">{c.reference}</span>
                        {c.supported === true && <span className="text-emerald-600" title={t("agent.artifact_supported", "supported")}>✓</span>}
                        {c.supported === false && <span className="text-amber-600" title={t("agent.artifact_unverified", "unverified")}>?</span>}
                        {(c.tier === 2 || c.tier === 3) && (
                          <span className="rounded bg-amber-500/15 px-1 font-mono text-amber-600" title={`tier ${c.tier}`}>{c.tier}</span>
                        )}
                      </>
                    );
                    const expandable = Boolean(c.excerpt || c.claim || c.url);
                    if (!expandable) {
                      return <li key={i} className="flex items-start gap-1.5">{head}</li>;
                    }
                    return (
                      <li key={i}>
                        <details className="group">
                          <summary className="flex cursor-pointer list-none items-start gap-1.5 [&::-webkit-details-marker]:hidden">
                            {head}
                            <span className="text-muted-foreground transition-transform group-open:rotate-90">›</span>
                          </summary>
                          <div className="mt-1 space-y-1.5 border-s-2 border-border ps-2">
                            {c.claim && (
                              <p className="text-muted-foreground" dir="auto">
                                <span className="font-medium">{t("agent.artifact_claim", "Claim")}: </span>
                                {c.claim}
                              </p>
                            )}
                            {c.excerpt && (
                              <blockquote className="whitespace-pre-wrap leading-relaxed text-foreground/80" dir="auto">
                                {c.excerpt}
                              </blockquote>
                            )}
                            {c.url && (
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                {t("agent.artifact_open_source", "Open the source")}
                              </a>
                            )}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              ) : a.html ? (
                <div className="prose prose-sm max-w-none dark:prose-invert [&_*]:text-xs" dangerouslySetInnerHTML={{ __html: a.html }} />
              ) : (
                <pre className="whitespace-pre-wrap font-sans">{a.text ?? ""}</pre>
              )}
            </div>
            {a.targetChapter && a.status === "final" && (
              <div className="border-t border-border px-2 py-1 text-xs text-muted-foreground">
                → {a.targetChapter}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export { AgentArtifactPanel };
export default AgentArtifactPanel;
