import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FloatingBubbleMenu } from "@/components/editor/FloatingBubbleMenu";
import { SlashCommandMenu } from "@/components/editor/SlashCommandMenu";
import { getTasksForSurface } from "@/lib/tasks/registry";

describe("FloatingBubbleMenu & SlashCommandMenu (M3 Pillar B)", () => {
  it("strictly excludes auto_format from bubble surface tasks", () => {
    const bubbleTasks = getTasksForSurface("bubble");
    const autoFormatTask = bubbleTasks.find((t) => t.slug === "auto_format");
    expect(autoFormatTask).toBeUndefined();
  });

  it("includes auto_format on slash surface tasks", () => {
    const slashTasks = getTasksForSurface("slash");
    const autoFormatTask = slashTasks.find((t) => t.slug === "auto_format");
    expect(autoFormatTask).toBeDefined();
  });

  it("returns null when editor instance is null", () => {
    const dummyActions = {
      onAddHarakat: () => {},
      onRemoveHarakat: () => {},
      onSpellCheck: () => {},
      onParaphrase: () => {},
      onSummarize: () => {},
      onCitations: () => {},
    };

    const { container: bubbleContainer } = render(
      <FloatingBubbleMenu editor={null} actions={dummyActions} aiBusy={null} />,
    );
    expect(bubbleContainer.firstChild).toBeNull();

    const { container: slashContainer } = render(
      <SlashCommandMenu editor={null} actions={dummyActions} onAutoFormat={() => {}} />,
    );
    expect(slashContainer.firstChild).toBeNull();
  });
});
