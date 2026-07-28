import { describe, it, expect } from "vitest";
import { BUILTIN_TASKS, TASK_REGISTRY, getTaskBySlug, getTasksForSurface } from "@/lib/tasks/registry";
import { calculateTaskCost, checkSolvency } from "@/lib/tasks/cost";

describe("Task Registry & Built-in Tasks (M3 Pillar A)", () => {
  it("registers exactly 12 built-in tasks", () => {
    expect(BUILTIN_TASKS.length).toBe(12);
    expect(TASK_REGISTRY.size).toBe(12);
  });

  it("includes all 4 previously hidden server actions", () => {
    const hiddenSlugs = ["normalize_script", "formalize", "humanize", "shorten"];
    for (const slug of hiddenSlugs) {
      const task = getTaskBySlug(slug);
      expect(task).toBeDefined();
      expect(task?.engine).toBe("refine-text");
    }
  });

  it("excludes auto_format from the bubble surface", () => {
    const bubbleTasks = getTasksForSurface("bubble");
    const autoFormatInBubble = bubbleTasks.some((t) => t.slug === "auto_format");
    expect(autoFormatInBubble).toBe(false);

    const autoFormatTask = getTaskBySlug("auto_format");
    expect(autoFormatTask?.surfaces).not.toContain("bubble");
    expect(autoFormatTask?.surfaces).toContain("toolbar");
  });

  it("handles client engine remove_harakat instantly with 0 cost", () => {
    const task = getTaskBySlug("remove_harakat");
    expect(task).toBeDefined();
    expect(task?.engine).toBe("client");

    const cost = calculateTaskCost(task!, 5000);
    expect(cost).toBe(0);

    const stripped = task?.clientFn?.("مرحبا بِكُمْ أَيُّهَا الأَصْدِقَاءُ");
    expect(stripped).toBe("مرحبا بكم أيها الأصدقاء");
  });
});

describe("Task Cost Engine & Solvency Checks", () => {
  it("calculates 5 tokens per 2000 character starting chunk", () => {
    const task = getTaskBySlug("add_harakat")!;

    expect(calculateTaskCost(task, 100)).toBe(5);
    expect(calculateTaskCost(task, 1999)).toBe(5);
    expect(calculateTaskCost(task, 2001)).toBe(10);
    expect(calculateTaskCost(task, 4500)).toBe(15);
  });

  it("correctly identifies solvent vs insolvent balances", () => {
    expect(checkSolvency(10, 50).isSolvent).toBe(true);
    expect(checkSolvency(10, 50).deficit).toBe(0);

    const insolvent = checkSolvency(25, 10);
    expect(insolvent.isSolvent).toBe(false);
    expect(insolvent.deficit).toBe(15);
  });
});
