import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ChefHat, Play, Loader2, Coins, AlertCircle, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { recipeService, type Recipe } from "@/lib/recipes/recipeService";
import { RecipeRunProgress } from "./RecipeRunProgress";
import { EmptyState } from "./EmptyState";
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

export const RecipesTab: React.FC = () => {
  const { t } = useLanguage();
  const { total } = useTokenBalance();
  const workspace = useOptionalWorkspace();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  // Selected recipe for solvency run confirmation
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await recipeService.listRecipes();
      setRecipes(res);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleOpenRunDialog = async (recipe: Recipe) => {
    const docId = workspace?.activeDocumentId;
    if (!docId) {
      toast.error(translateStored("toast.workspace.no_document"));
      return;
    }

    const doc = await documentService.getDocument(docId);
    const text = doc ? extractPlainTextFromJSON(doc.content_json) || doc.plain_text || "" : "";
    if (!text.trim()) {
      toast.error(translateStored("toast.workspace.empty_document"));
      return;
    }

    setDocText(text);
    setSelectedRecipe(recipe);
    setProgress(null);
  };

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
        setTimeout(() => setSelectedRecipe(null), 1200);
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
    <div className="flex flex-col h-full bg-background p-3">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-primary">
          <ChefHat className="h-4 w-4" />
          <span>{t("library.recipes_title", "Automated pipelines (Recipes)")}</span>
        </div>
      </div>

      <ScrollArea className="flex-1 pe-1">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground text-center py-8">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-primary" />
            {t("library.recipes_loading", "Loading pipelines…")}
          </div>
        ) : recipes.length === 0 ? (
          <EmptyState
            icon={ChefHat}
            title={t("library.no_recipes", "No recipes available")}
            description={t("library.no_recipes_hint", "Recipes run a fixed set of AI steps over the open document — check that the recipes feature is enabled.")}
          />
        ) : (
          <div className="space-y-2">
            {recipes.map((item) => {
              const estimatedCost = calculateRecipeCost(item, 2000);

              return (
                <div
                  key={item.id}
                  className="p-3 rounded-lg border bg-card hover:bg-accent/40 text-xs transition-colors space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0 flex-1">
                      <h4 className="font-medium text-foreground text-xs flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                        {item.title}
                      </h4>
                      {item.description && (
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      )}
                    </div>

                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 px-2.5 text-xs gap-1 bg-primary shrink-0"
                      onClick={() => handleOpenRunDialog(item)}
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      {t("library.run_recipe", "Run")}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t text-xs text-muted-foreground">
                    <div className="flex flex-wrap gap-1">
                      {item.steps.map((s, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs px-1 py-0 font-normal">
                          {idx + 1}. {s.stepLabel}
                        </Badge>
                      ))}
                    </div>
                    <span className="font-medium text-primary flex items-center gap-0.5">
                      <Coins className="h-3.5 w-3.5" />
                      ~{t("library.tokens", "{count} tokens").replace("{count}", String(estimatedCost))}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Pre-flight Solvency Run Dialog */}
      <Dialog open={selectedRecipe !== null} onOpenChange={(open) => !open && !isRunning && setSelectedRecipe(null)}>
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
            <Button variant="outline" size="sm" onClick={() => setSelectedRecipe(null)} disabled={isRunning}>
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
    </div>
  );
};
