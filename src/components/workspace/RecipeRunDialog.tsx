import React, { useEffect, useMemo, useState } from "react";
import { ChefHat, Play, Loader2, Coins, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Recipe } from "@/lib/recipes/recipeService";
import { RecipeRunProgress } from "./RecipeRunProgress";
import {
  runRecipePipeline,
  calculateRecipeCost,
  validateRecipe,
  type RecipeProgress,
} from "@/lib/recipes/recipeOrchestrator";
import { useTokenBalance } from "@/hooks/useTokenBalance";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { documentService, extractPlainTextFromJSON } from "@/core/workspace/documentService";
import { toast } from "sonner";
import { translateStored, translateStoredFormat } from "@/lib/i18n";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Confirm and run one recipe over the open document: its steps, the estimated
 * total cost against the balance, any step that cannot run, and live progress.
 * Opened from the Recipes tab and from the editor's `/` menu (SYSTEM-2026 §7).
 */
export const RecipeRunDialog: React.FC<{ recipe: Recipe | null; onClose: () => void }> = ({ recipe, onClose }) => {
  const { t } = useLanguage();
  const { total } = useTokenBalance();
  const workspace = useOptionalWorkspace();
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [docText, setDocText] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<RecipeProgress | null>(null);

  // Checked before the dialog can start anything: a recipe with a step that
  // cannot run over a whole document must be refused up front, not halfway.
  const validation = useMemo(
    () => (selectedRecipe ? validateRecipe(selectedRecipe) : null),
    [selectedRecipe],
  );

  const close = () => {
    setSelectedRecipe(null);
    setDocText("");
    onClose();
  };

  // Opening needs the document's text, both for the cost estimate and to
  // refuse an empty document before anything is charged.
  useEffect(() => {
    if (!recipe) {
      setSelectedRecipe(null);
      setDocText("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const docId = workspace?.activeDocumentId;
      if (!docId) {
        toast.error(translateStored("toast.workspace.no_document"));
        onClose();
        return;
      }
      const doc = await documentService.getDocument(docId);
      const text = doc ? extractPlainTextFromJSON(doc.content_json) || doc.plain_text || "" : "";
      if (cancelled) return;
      if (!text.trim()) {
        toast.error(translateStored("toast.workspace.empty_document"));
        onClose();
        return;
      }
      setDocText(text);
      setSelectedRecipe(recipe);
      setProgress(null);
    })();
    return () => {
      cancelled = true;
    };
    // Only a newly chosen recipe re-opens the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe]);

  const handleExecuteRecipe = async () => {
    if (!selectedRecipe) return;
    const available = total ?? 0;

    // Recipes edit the document, so they need the mounted editor's runner.
    const runDocumentTask = workspace?.runDocumentTask;
    if (!runDocumentTask) {
      toast.error(translateStored("toast.workspace.open_canvas_first"));
      return;
    }

    setIsRunning(true);
    try {
      const final = await runRecipePipeline({
        recipe: selectedRecipe,
        executeStep: (step) => runDocumentTask(step.taskSlug),
        documentLength: docText.length,
        availableTokens: available,
        onProgress: setProgress,
      });

      const spent = final.stepOutcomes.reduce((sum, s) => sum + s.tokensSpent, 0);

      if (final.status === "completed") {
        toast.success(translateStoredFormat("toast.recipe.complete", {
          title: selectedRecipe.title,
          steps: final.totalSteps,
          tokens: spent,
        }));
        setTimeout(close, 1200);
      } else {
        // Never report success for a run that stopped: the applied steps stay
        // in the document, and the user is told exactly where it stopped.
        toast.error(final.error ?? translateStored("toast.recipe.failed"));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : translateStored("toast.recipe.run_failed"));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Dialog open={selectedRecipe !== null && docText !== ""} onOpenChange={(open) => !open && !isRunning && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-primary">
            <ChefHat className="h-5 w-5" />
            {selectedRecipe?.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t("library.recipe_dialog_desc", "This automated pipeline will run through all the steps below in order.")}
          </DialogDescription>
        </DialogHeader>

        {selectedRecipe && (
          <div className="space-y-3 py-1 text-xs">
            <div className="p-3 bg-muted rounded-lg border space-y-1.5">
              <h4 className="font-semibold text-foreground text-xs">{t("library.steps_heading", "Steps:")}</h4>
              <div className="space-y-1">
                {selectedRecipe.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="w-4 h-4 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-xs">
                      {i + 1}
                    </span>
                    <span>{s.stepLabel}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/60 text-xs">
                <span className="text-muted-foreground">{t("library.est_total_cost", "Estimated total cost:")}</span>
                <span className="font-bold text-primary flex items-center gap-1">
                  <Coins className="h-3.5 w-3.5" />
                  {t("library.tokens", "{count} tokens").replace("{count}", String(calculateRecipeCost(selectedRecipe, docText.length)))}
                </span>
              </div>

              {total !== undefined && total < calculateRecipeCost(selectedRecipe, docText.length) && (
                <div className="flex items-center gap-1.5 text-destructive text-xs font-medium pt-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{t("library.insufficient_tokens", "Insufficient tokens! Balance: {balance}").replace("{balance}", String(total))}</span>
                </div>
              )}
            </div>

            <RecipeRunProgress
              problems={validation?.ok === false ? validation.problems : undefined}
              progress={progress}
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={close} disabled={isRunning}>
            {t("common.cancel", "Cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleExecuteRecipe}
            disabled={
              isRunning ||
              !selectedRecipe ||
              !validation?.ok ||
              (total !== undefined && total < calculateRecipeCost(selectedRecipe, docText.length))
            }
            className="gap-1.5 bg-primary hover:bg-primary/90"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
            {t("library.start_pipeline", "Start pipeline")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
