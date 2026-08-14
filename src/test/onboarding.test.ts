import { beforeEach, describe, expect, it } from "vitest";
import { hasSeenWorkspaceHint, dismissWorkspaceHint } from "@/lib/onboarding";

describe("workspace first-run hint persistence", () => {
  beforeEach(() => localStorage.clear());

  it("has not been seen for a brand-new user", () => {
    expect(hasSeenWorkspaceHint()).toBe(false);
  });

  it("stays dismissed once marked seen — a hint, not a tour that repeats", () => {
    dismissWorkspaceHint();
    expect(hasSeenWorkspaceHint()).toBe(true);
  });
});
