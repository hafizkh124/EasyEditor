import { describe, it, expect, vi } from "vitest";
import {
  runRecipePipeline,
  validateRecipe,
  calculateRecipeCost,
} from "@/lib/recipes/recipeOrchestrator";
import type { Recipe } from "@/lib/recipes/recipeService";
import type { DocumentTaskOutcome } from "@/core/workspace/WorkspaceContext";

/**
 * SPEC-M4 FR-4.4–FR-4.6. The pipeline used to be a simulation that slept 800ms
 * per step and reported success, so these tests pin the three properties that
 * separate a real run from that: steps actually execute, a failed step stops
 * the run, and nothing runs before the cost is affordable.
 */

const recipe = (steps: Array<{ taskSlug: string; stepLabel: string }>): Recipe => ({
  id: "r1",
  title: "ٹیسٹ Recipe",
  steps,
  is_builtin: true,
  created_at: new Date().toISOString(),
});

const POLISH = recipe([
  { taskSlug: "normalize_script", stepLabel: "رسم الخط" },
  { taskSlug: "spelling_check", stepLabel: "املا" },
  { taskSlug: "formalize", stepLabel: "اسلوب" },
]);

const ok = (applied = 3): DocumentTaskOutcome => ({
  ok: true,
  applied,
  total: applied,
  tokensSpent: 15,
});

describe("validateRecipe (FR-4.3)", () => {
  it("rejects section summaries, which a whole-document run would write over the text", () => {
    const result = validateRecipe(recipe([{ taskSlug: "summarize_sections", stepLabel: "خلاصہ" }]));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("متن بدل جائے گا");
  });

  it("rejects a step whose task is not chunkable over a document", () => {
    // `summarize` is selection-scoped: a whole-document run would replace the
    // document with its own summary.
    const result = validateRecipe(recipe([{ taskSlug: "summarize", stepLabel: "خلاصہ" }]));
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("خلاصہ");
  });

  it("rejects an unknown task slug", () => {
    const result = validateRecipe(recipe([{ taskSlug: "no_such_task", stepLabel: "غلط" }]));
    expect(result.ok).toBe(false);
  });

  it("rejects a client-only task", () => {
    const result = validateRecipe(recipe([{ taskSlug: "remove_harakat", stepLabel: "حرکات" }]));
    expect(result.ok).toBe(false);
  });

  it("accepts a recipe whose steps all run over a document", () => {
    expect(validateRecipe(POLISH).ok).toBe(true);
  });
});

describe("runRecipePipeline (FR-4.5 / FR-4.6)", () => {
  it("executes every step in order", async () => {
    const seen: string[] = [];
    const result = await runRecipePipeline({
      recipe: POLISH,
      executeStep: async (step) => {
        seen.push(step.taskSlug);
        return ok();
      },
      documentLength: 1000,
      availableTokens: 10_000,
    });

    expect(seen).toEqual(["normalize_script", "spelling_check", "formalize"]);
    expect(result.status).toBe("completed");
    expect(result.stepOutcomes).toHaveLength(3);
  });

  it("stops at a failed step and never starts the next one", async () => {
    const seen: string[] = [];
    const result = await runRecipePipeline({
      recipe: POLISH,
      executeStep: async (step) => {
        seen.push(step.taskSlug);
        if (step.taskSlug === "spelling_check") {
          return { ok: false, applied: 0, total: 4, tokensSpent: 0, reason: "سرور دستیاب نہیں" };
        }
        return ok();
      },
      documentLength: 1000,
      availableTokens: 10_000,
    });

    expect(seen).toEqual(["normalize_script", "spelling_check"]);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("قدم 2 از 3");
    expect(result.error).toContain("سرور دستیاب نہیں");
    // The first step's work stays — it is already in the document.
    expect(result.stepOutcomes[0].ok).toBe(true);
  });

  it("treats a cancelled step as a stop, not a success", async () => {
    const result = await runRecipePipeline({
      recipe: POLISH,
      executeStep: async () => ({
        ok: false,
        applied: 2,
        total: 5,
        tokensSpent: 10,
        reason: "صارف نے منسوخ کر دیا۔",
      }),
      documentLength: 1000,
      availableTokens: 10_000,
    });

    expect(result.status).toBe("failed");
    expect(result.stepOutcomes[0].applied).toBe(2);
  });

  it("sends no request when the wallet cannot cover every step", async () => {
    const executeStep = vi.fn();
    const cost = calculateRecipeCost(POLISH, 1000);

    await expect(
      runRecipePipeline({
        recipe: POLISH,
        executeStep,
        documentLength: 1000,
        availableTokens: cost - 1,
        onProgress: () => {},
      }),
    ).rejects.toThrow(/ٹوکن ناکافی/);

    expect(executeStep).not.toHaveBeenCalled();
  });

  it("refuses an invalid recipe before charging anything", async () => {
    const executeStep = vi.fn();

    await expect(
      runRecipePipeline({
        recipe: recipe([{ taskSlug: "summarize", stepLabel: "خلاصہ" }]),
        executeStep,
        documentLength: 1000,
        availableTokens: 10_000,
      }),
    ).rejects.toThrow();

    expect(executeStep).not.toHaveBeenCalled();
  });

  it("stops before the next step when the run is aborted", async () => {
    const controller = new AbortController();
    const seen: string[] = [];

    const result = await runRecipePipeline({
      recipe: POLISH,
      executeStep: async (step) => {
        seen.push(step.taskSlug);
        controller.abort();
        return ok();
      },
      documentLength: 1000,
      availableTokens: 10_000,
      signal: controller.signal,
    });

    expect(seen).toEqual(["normalize_script"]);
    expect(result.status).toBe("cancelled");
  });

  it("costs every step, not just one", () => {
    const one = calculateRecipeCost(recipe([{ taskSlug: "spelling_check", stepLabel: "املا" }]), 4000);
    expect(calculateRecipeCost(POLISH, 4000)).toBe(one * 3);
  });
});
