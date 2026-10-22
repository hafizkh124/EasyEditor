import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * SYSTEM-2026 §9 — the jobs strip: present only while there is a job to show,
 * with progress, and the right action for each state.
 */

vi.mock("@/contexts/LanguageContext", () => ({
  useLanguage: () => ({ t: (_k: string, f?: string) => f ?? _k, language: "ur" }),
}));

import { JobsStrip } from "@/components/jobs/JobsStrip";
import { addJob, getJob, registerCancel, resetJobsForTest, updateJob, visibleJobs, type Job } from "@/lib/jobs/jobStore";

const renderStrip = () =>
  render(
    <MemoryRouter>
      <JobsStrip variant="sidebar" />
    </MemoryRouter>,
  );

describe("JobsStrip", () => {
  beforeEach(() => resetJobsForTest());

  it("is absent with nothing to show", () => {
    renderStrip();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows running jobs with progress, and cancels one", () => {
    const cancel = vi.fn();
    addJob({ id: "a", kind: "translate", title: "کتاب الصلاۃ", status: "running", href: "/translate-book/p1", total: 10, current: 3 });
    registerCancel("a", cancel);
    renderStrip();
    expect(screen.getByText("1 کام جاری")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 کام جاری/ }));
    expect(screen.getByRole("link", { name: "کتاب الصلاۃ" })).toHaveAttribute("href", "/translate-book/p1");
    expect(screen.getAllByText(/3\/10/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "منسوخ" }));
    expect(cancel).toHaveBeenCalled();
  });

  it("offers Resume for an interrupted job, and Remove for a finished one", () => {
    addJob({ id: "b", kind: "extract", title: "بیان.m4a", status: "interrupted", resumable: true });
    addJob({ id: "c", kind: "agent", title: "خلاصہ", status: "running" });
    act(() => updateJob("c", { status: "done" }));
    renderStrip();
    expect(screen.getByText("1 کام توجہ چاہتے ہیں")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /توجہ/ }));
    expect(screen.getByRole("button", { name: "جاری رکھیں" })).toBeInTheDocument();
    const removes = screen.getAllByRole("button", { name: "فہرست سے ہٹائیں" });
    // Newest first: the finished agent task leads the list.
    fireEvent.click(removes[0]);
    expect(getJob("c")).toBeUndefined();
  });

  it("keeps a finished job only for a while", () => {
    const old: Job = { id: "d", kind: "extract", title: "x", status: "done", current: 1, total: 1, createdAt: 0, updatedAt: 0 };
    const stuck: Job = { ...old, id: "e", status: "approval" };
    expect(visibleJobs([old, stuck], 60 * 60 * 1000).map((j) => j.id)).toEqual(["e"]);
  });
});
