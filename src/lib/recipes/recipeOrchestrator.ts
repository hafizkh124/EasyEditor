import { getTaskBySlug } from "@/lib/tasks/registry";
import { isRefineTextAction } from "@/lib/editor/aiActions";
import { calculateTaskCost } from "@/lib/tasks/cost";
import type { DocumentTaskOutcome } from "@/core/workspace/WorkspaceContext";
import type { Recipe, RecipeStep } from "./recipeService";

export interface RecipeProgress {
  recipeId: string;
  currentStepIndex: number;
  totalSteps: number;
  currentStepLabel: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  /** Filled once a step finishes, so the UI can show "3 از 5 حصے" per step. */
  stepOutcomes: RecipeStepOutcome[];
  error?: string;
}

export interface RecipeStepOutcome {
  taskSlug: string;
  stepLabel: string;
  ok: boolean;
  applied: number;
  total: number;
  tokensSpent: number;
  reason?: string;
}

/**
 * Pre-flight cost for every step of a recipe (SPEC-M4 FR-4.4, Principle 5).
 *
 * Each step rewrites the whole document, so each one costs what a whole-document
 * run of that task costs — the sum is the number the confirmation dialog must
 * show before a single request goes out.
 */
export function calculateRecipeCost(recipe: Recipe, textLength: number): number {
  let totalCost = 0;
  for (const step of recipe.steps) {
    const task = getTaskBySlug(step.taskSlug);
    if (!task) continue;
    totalCost += calculateTaskCost(task, textLength);
  }
  return totalCost;
}

/**
 * Reject a recipe before it charges anyone (SPEC-M4 FR-4.3).
 *
 * A step that cannot run over a whole document must stop the recipe here, not
 * halfway through — otherwise the user pays for step 1 and then finds out
 * step 2 was never runnable.
 */
export function validateRecipe(recipe: Recipe): { ok: boolean; problems: string[] } {
  const problems: string[] = [];

  if (!recipe.steps || recipe.steps.length === 0) {
    problems.push("اس Recipe میں کوئی قدم درج نہیں۔");
  }

  for (const step of recipe.steps ?? []) {
    const task = getTaskBySlug(step.taskSlug);
    if (!task) {
      problems.push(`'${step.stepLabel}': ٹاسک '${step.taskSlug}' دستیاب نہیں۔`);
      continue;
    }
    if (task.engine === "client") {
      problems.push(`'${step.stepLabel}': یہ ٹاسک صرف منتخب متن پر چلتا ہے۔`);
      continue;
    }
    if (!task.chunkable) {
      problems.push(
        `'${step.stepLabel}': '${task.defaultLabel}' پوری دستاویز پر نہیں چل سکتا۔`,
      );
      continue;
    }
    // The chunked runner only accepts the actions it knows how to apply (a
    // custom task runs its own prompt by id).
    if (!task.taskId && (!task.actionName || !isRefineTextAction(task.actionName))) {
      problems.push(
        `'${step.stepLabel}': '${task.defaultLabel}' پوری دستاویز پر نہیں چل سکتا۔`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

export interface RunRecipeArgs {
  recipe: Recipe;
  /** Runs one task over the whole document — see WorkspaceContext. */
  executeStep: (step: RecipeStep) => Promise<DocumentTaskOutcome>;
  documentLength: number;
  availableTokens: number;
  onProgress?: (progress: RecipeProgress) => void;
  signal?: AbortSignal;
}

/**
 * Run a recipe's steps in order (SPEC-M4 FR-4.5–FR-4.6).
 *
 * Sequential on purpose: `refine-text` allows 30 requests/minute per user and
 * that budget is shared, so two steps in flight together would spend the run's
 * way into a 429. Fail-stop is also on purpose — every step reads the document
 * the previous step wrote, so continuing past a failure would apply step 3 to
 * text step 2 never produced.
 */
export async function runRecipePipeline({
  recipe,
  executeStep,
  documentLength,
  availableTokens,
  onProgress,
  signal,
}: RunRecipeArgs): Promise<RecipeProgress> {
  const totalSteps = recipe.steps.length;
  const stepOutcomes: RecipeStepOutcome[] = [];

  const emit = (progress: RecipeProgress) => {
    onProgress?.({ ...progress, stepOutcomes: [...progress.stepOutcomes] });
    return progress;
  };

  const validation = validateRecipe(recipe);
  if (!validation.ok) {
    throw new Error(validation.problems.join(" "));
  }

  const totalCost = calculateRecipeCost(recipe, documentLength);
  if (availableTokens < totalCost) {
    throw new Error(`ٹوکن ناکافی ہیں! کل لاگت: ${totalCost} ٹوکن، آپ کا بیلنس: ${availableTokens}`);
  }

  for (let i = 0; i < totalSteps; i++) {
    const step = recipe.steps[i];

    if (signal?.aborted) {
      return emit({
        recipeId: recipe.id,
        currentStepIndex: i,
        totalSteps,
        currentStepLabel: step.stepLabel,
        status: "cancelled",
        stepOutcomes,
        error: `قدم ${i + 1} سے پہلے منسوخ — پچھلے قدموں کا کام محفوظ ہے۔`,
      });
    }

    emit({
      recipeId: recipe.id,
      currentStepIndex: i,
      totalSteps,
      currentStepLabel: step.stepLabel,
      status: "running",
      stepOutcomes,
    });

    const outcome = await executeStep(step);
    stepOutcomes.push({
      taskSlug: step.taskSlug,
      stepLabel: step.stepLabel,
      ok: outcome.ok,
      applied: outcome.applied,
      total: outcome.total,
      tokensSpent: outcome.tokensSpent,
      reason: outcome.reason,
    });

    if (!outcome.ok) {
      return emit({
        recipeId: recipe.id,
        currentStepIndex: i,
        totalSteps,
        currentStepLabel: step.stepLabel,
        status: "failed",
        stepOutcomes,
        error: `قدم ${i + 1} از ${totalSteps} ('${step.stepLabel}') پر رک گیا: ${
          outcome.reason ?? "نامعلوم خرابی"
        }`,
      });
    }
  }

  return emit({
    recipeId: recipe.id,
    currentStepIndex: totalSteps,
    totalSteps,
    currentStepLabel: "تمام قدم مکمل",
    status: "completed",
    stepOutcomes,
  });
}
