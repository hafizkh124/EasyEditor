import React from "react";
import { AlertCircle } from "lucide-react";
import type { RecipeProgress } from "@/lib/recipes/recipeOrchestrator";

interface RecipeRunProgressProps {
  /** Why this recipe cannot run at all, if so (SPEC-M4 FR-4.3). */
  problems?: string[];
  progress: RecipeProgress | null;
}

/**
 * Live state of a recipe run: what stopped it from starting, which step it is
 * on, and what each finished step actually did.
 *
 * The per-step line matters more than the bar: a run that stopped at step 2
 * must never look like one that completed (SPEC-M4 FR-4.6).
 */
export const RecipeRunProgress: React.FC<RecipeRunProgressProps> = ({ problems, progress }) => {
  const percent = progress
    ? Math.round(((progress.currentStepIndex + 1) / progress.totalSteps) * 100)
    : 0;

  return (
    <>
      {problems && problems.length > 0 && (
        <div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/20 space-y-1">
          {problems.map((p, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}

      {progress && (
        <div className="space-y-1.5 p-2.5 bg-primary/10 border border-primary/20 rounded-md">
          <div className="flex justify-between font-medium text-primary text-xs">
            <span>
              مرحلہ {progress.currentStepIndex + 1} از {progress.totalSteps}:{" "}
              {progress.currentStepLabel}
            </span>
            <span>{percent}%</span>
          </div>

          <div className="w-full bg-primary/20 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>

          {progress.stepOutcomes.map((o, i) => (
            <div
              key={i}
              className={`flex items-center justify-between text-[11px] ${
                o.ok ? "text-muted-foreground" : "text-destructive font-medium"
              }`}
            >
              <span className="truncate">{o.stepLabel}</span>
              <span className="shrink-0 ps-2">
                {o.ok ? `${o.applied} از ${o.total} حصے` : (o.reason ?? "ناکام")}
              </span>
            </div>
          ))}

          {progress.error && (
            <p className="text-[11px] text-destructive font-medium pt-1">{progress.error}</p>
          )}
        </div>
      )}
    </>
  );
};
