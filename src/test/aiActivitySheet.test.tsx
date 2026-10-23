import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";

vi.mock("@/components/workspace/TrustTab", () => ({ TrustTab: () => <div data-testid="trust-tab" /> }));

import { AiActivitySheet } from "@/components/workspace/AiActivitySheet";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return <AiActivitySheet side="right" open={open} onOpenChange={setOpen} />;
}

describe("AiActivitySheet", () => {
  it("shows the run record only once opened (it reads from the database on mount)", () => {
    render(<Harness />);
    expect(screen.queryByTestId("trust-tab")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "AI activity" }));
    expect(screen.getByTestId("trust-tab")).toBeInTheDocument();
    expect(screen.getByText("AI runs & sources")).toBeInTheDocument();
  });
});
