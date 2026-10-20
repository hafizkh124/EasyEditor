import React from "react";
import { ExternalLink, BookmarkPlus } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { cn } from "@/lib/utils";
import { classifyHadithGrade, GRADE_FAMILY_STYLE } from "@/lib/citations/hadithGrade";
import { buildFootnotePrefill, type ArtifactState } from "../agentArtifactState";
import { CitationFeedbackBar } from "@/components/research/CitationFeedbackBar";
import { UNVERIFIED_DISCLAIMER_AR } from "../../../../shared/citation/verifyCitation";
import { SanadTree } from "./SanadTree";
import { NarratorCard } from "./NarratorCard";
import { MatnDiff, type MatnDiffPayload } from "./MatnDiff";
import type { SanadTreePayload, NarratorCardPayload } from "../../../../shared/jkhssn/types";

/** M13 (ADR-0058) — ask the agent composer (`useAgentRun`) to pre-fill an insert-footnote request. */
function requestFootnotePrefill(sourceId: string, footnote: string): void {
  window.dispatchEvent(new CustomEvent("agent-prefill", { detail: { text: buildFootnotePrefill(sourceId, footnote) } }));
}

/**
 * Plan §5.2 — the artifact body renderer, shared by the compact timeline chip
 * (small) and the full stage (large). Switches on `artifact.type`: the three
 * ADR-0045 visualisations render from `artifact.data`, everything else uses the
 * document/table/citation-list render lifted from `AgentArtifactPanel`.
 */
export const ArtifactBody: React.FC<{ artifact: ArtifactState; compact?: boolean }> = ({ artifact: a, compact }) => {
  const { t } = useLanguage();

  if (a.type === "sanad-tree" && a.data) {
    return <SanadTree payload={a.data as SanadTreePayload} />;
  }
  if (a.type === "narrator-card") {
    return <NarratorCard variant="stage" payload={(a.data as NarratorCardPayload) ?? null} />;
  }
  if (a.type === "matn-diff" && a.data) {
    return <MatnDiff payload={a.data as MatnDiffPayload} />;
  }

  if (a.table) {
    return (
      <div className={cn("overflow-x-auto", !compact && "max-h-full")}>
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
      </div>
    );
  }

  if (a.citations) {
    return (
      <ul className="space-y-1 text-xs">
        {a.citations.map((c, i) => {
          const head = (
            <>
              <span className="font-mono text-muted-foreground">{c.marker}</span>
              <span className="flex-1">{c.reference}</span>
              {c.supported === true && <span className="text-emerald-600" title={t("agent.artifact_supported", "supported")}>✓</span>}
              {c.supported === false && <span className="text-amber-600" title={t("agent.artifact_unverified", "unverified")}>?</span>}
              {c.grade && c.gradedBy === "" && (
                <span
                  className="rounded-full border border-border bg-muted px-1.5 leading-none text-muted-foreground"
                  title={t("citations.grade_unattributed", "The source named no scholar for this grade — not shown as a ruling")}
                >
                  {UNVERIFIED_DISCLAIMER_AR}
                </span>
              )}
              {c.grade && c.gradedBy !== "" && (() => {
                const fam = classifyHadithGrade(c.grade);
                const style = fam ? GRADE_FAMILY_STYLE[fam] : null;
                return (
                  <span
                    className={cn("rounded-full border px-1.5 leading-none", style ? style.chip : "border-border bg-muted text-muted-foreground")}
                    title={t("citations.grade_disclaimer", "{source}: {grade} — graded by the source, not by us").replace("{source}", c.gradedBy || "الدرر السنية").replace("{grade}", c.grade)}
                  >
                    {style ? style.label : c.grade}
                  </span>
                );
              })()}
            </>
          );
          // Every AI citation expands to its feedback bar (Approve / Edit).
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
                      <span className="font-medium">{t("agent.artifact_claim", "Claim")}: </span>{c.claim}
                    </p>
                  )}
                  {c.excerpt && (
                    <blockquote className="whitespace-pre-wrap leading-relaxed text-foreground/80" dir="auto">{c.excerpt}</blockquote>
                  )}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      {t("agent.artifact_open_source", "Open the source")}
                    </a>
                  )}
                  <CitationFeedbackBar
                    citation={{ reference: c.reference, grade: c.grade, gradedBy: c.gradedBy || undefined, sourceUrl: c.url }}
                    sourceId={c.sourceId}
                    onApprove={c.footnote ? () => requestFootnotePrefill(c.sourceId, c.footnote!) : undefined}
                  />
                  {c.footnote && (
                    <div className="space-y-1">
                      <p className="rounded bg-muted px-1.5 py-1" dir="rtl">{c.footnote}</p>
                      {/* M13 (ADR-0058) — pre-fills the composer; never inserts on its own (ADR-0049). */}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-primary hover:bg-accent"
                        onClick={() => requestFootnotePrefill(c.sourceId, c.footnote!)}
                      >
                        <BookmarkPlus className="h-3 w-3 shrink-0" />
                        {t("agent.artifact_add_footnote", "حاشیہ لگائیں")}
                      </button>
                    </div>
                  )}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    );
  }

  if (a.html) {
    return <div className="prose prose-sm max-w-none dark:prose-invert [&_*]:text-xs" dangerouslySetInnerHTML={{ __html: a.html }} />;
  }
  return <pre className="whitespace-pre-wrap font-sans text-xs">{a.text ?? ""}</pre>;
};
