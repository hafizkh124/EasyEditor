import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const insert = vi.fn();
let session: { user: { id: string } } | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session } }) },
    from: () => ({ insert }),
  },
}));
vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, fallback?: string) => fallback ?? _k }),
}));

import { submitCitationFeedback, flushQueuedFeedback } from "@/lib/citationFeedback";
import { CitationFeedbackBar } from "@/components/research/CitationFeedbackBar";

const original = { reference: "صحيح البخاري، رقم 1", grade: "صحيح", gradedBy: "الألباني" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  session = { user: { id: "u1" } };
  insert.mockResolvedValue({ error: null });
});

describe("submitCitationFeedback / flushQueuedFeedback", () => {
  it("inserts an owner row when signed in", async () => {
    expect(await submitCitationFeedback({ action: "approve", sourceId: "s1", verifyStatus: "verified", original })).toBe("saved");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", action: "approve", source_id: "s1", verify_status: "verified" }));
  });

  it("queues offline, then flushes once signed in", async () => {
    session = null;
    expect(await submitCitationFeedback({ action: "approve", original })).toBe("queued");
    expect(insert).not.toHaveBeenCalled();
    session = { user: { id: "u1" } };
    expect(await flushQueuedFeedback()).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(await flushQueuedFeedback()).toBe(0);
  });

  it("queues when the insert fails (table not migrated yet)", async () => {
    insert.mockResolvedValueOnce({ error: { message: "42P01" } });
    expect(await submitCitationFeedback({ action: "approve", original })).toBe("queued");
  });

  it("a correction must carry the corrected citation", async () => {
    await expect(submitCitationFeedback({ action: "correct", original })).rejects.toThrow();
  });
});

describe("CitationFeedbackBar", () => {
  it("Approve logs the feedback and fires onApprove", async () => {
    const onApprove = vi.fn();
    render(<CitationFeedbackBar citation={original} sourceId="s1" onApprove={onApprove} />);
    fireEvent.click(screen.getByText("Approve & Insert"));
    await waitFor(() => expect(onApprove).toHaveBeenCalled());
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ action: "approve" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("Edit & Correct stores the corrected citation", async () => {
    render(<CitationFeedbackBar citation={original} sourceId="s1" />);
    fireEvent.click(screen.getByText("Edit & Correct"));
    fireEvent.change(screen.getByLabelText("Reference"), { target: { value: "صحيح مسلم، رقم 2" } });
    fireEvent.click(screen.getByText("Save correction"));
    await waitFor(() => expect(insert).toHaveBeenCalled());
    const row = insert.mock.calls[0][0];
    expect(row.action).toBe("correct");
    expect(row.corrected.reference).toBe("صحيح مسلم، رقم 2");
    expect(row.original.reference).toBe(original.reference);
  });

  it("shows the Arabic disclaimer for an unverified citation", () => {
    render(<CitationFeedbackBar citation={original} verifyStatus="unverified" />);
    expect(screen.getByRole("note")).toHaveTextContent("لم أقف عليه في المصادر المتاحة");
  });
});
