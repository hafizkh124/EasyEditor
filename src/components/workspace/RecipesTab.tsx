import React, { useEffect, useState, useCallback } from "react";
import { ChefHat, Play, Loader2, Coins, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { recipeService, type Recipe } from "@/lib/recipes/recipeService";
import { RecipeRunDialog } from "./RecipeRunDialog";
import { EmptyState } from "./EmptyState";
import { calculateRecipeCost } from "@/lib/recipes/recipeOrchestrator";
import { useLanguage } from "@/contexts/LanguageContext";

export const RecipesTab: React.FC = () => {
  const { t } = useLanguage();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);

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
                      onClick={() => setSelectedRecipe(item)}
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

      <RecipeRunDialog recipe={selectedRecipe} onClose={() => setSelectedRecipe(null)} />
    </div>
  );
};
