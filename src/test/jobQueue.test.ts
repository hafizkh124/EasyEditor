import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * SYSTEM-2026 §9 — one queue for long jobs. A job runs apart from the page
 * that started it; one that was running when the app closed comes back
 * "interrupted", and an extract job resumes from the pages it had already
 * read instead of reading (and charging for) them again.
 */

const stash = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("@/lib/jobs/fileStash", () => ({
  readStash: async (k: string) => stash.get(k),
  writeStash: async (k: string, patch: Record<string, unknown>) => void stash.set(k, { ...stash.get(k), ...patch }),
  deleteStash: async (k: string) => void stash.delete(k),
}));
const ocrPageImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ocr/ocrClient", () => ({ ocrPageImage: (...a: unknown[]) => ocrPageImage(...a) }));
vi.mock("@/lib/ocr/pdfRenderer", () => ({
  getPdfPageCount: async () => 2,
  renderPdfPages: async function* () {
    yield { pageNum: 1, totalPages: 2, imageBase64: "a", mimeType: "image/jpeg" };
    yield { pageNum: 2, totalPages: 2, imageBase64: "b", mimeType: "image/jpeg" };
  },
}));
const upsertUserSession = vi.hoisted(() => vi.fn(async () => "sess-9"));
vi.mock("@/lib/userSessions", () => ({ upsertUserSession }));
vi.mock("@/lib/activityLog", () => ({ logActivity: vi.fn() }));

import {
  addJob, updateJob, getJob, onJobFinished, resetJobsForTest, canResume, resumeJob, cancelJob, type Job,
} from "@/lib/jobs/jobStore";
import { startExtractJob, getExtractLive } from "@/lib/jobs/extractJob";
import "@/lib/jobs/runners";

const pdf = () => new File(["%PDF"], "kitab.pdf", { type: "application/pdf" });
const start = () =>
  startExtractJob({ file: pdf(), kind: "pdf", language: "auto", sttRoute: "cloud", userId: "u1", pageLabel: "صفحہ" });

describe("job store", () => {
  beforeEach(() => {
    resetJobsForTest();
    localStorage.clear();
  });

  it("announces a job once when it stops running, and keeps the list", () => {
    const finished = vi.fn();
    onJobFinished(finished);
    addJob({ id: "j1", kind: "translate", title: "کتاب", status: "running" });
    updateJob("j1", { current: 3, total: 10 });
    expect(finished).not.toHaveBeenCalled();
    updateJob("j1", { status: "done" });
    updateJob("j1", { title: "کتاب الصلاۃ" });
    expect(finished).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("easyeditor.jobs.v1")!)[0]).toMatchObject({ id: "j1", status: "done", current: 3 });
  });

});

describe("extract job", () => {
  beforeEach(() => {
    resetJobsForTest();
    stash.clear();
    ocrPageImage.mockReset();
    upsertUserSession.mockClear();
  });

  it("runs on its own, saves its result, and clears what it kept", async () => {
    ocrPageImage.mockResolvedValueOnce("پہلا").mockResolvedValueOnce("دوسرا");
    const job = start();
    expect(getJob(job.id)).toMatchObject({ status: "running", href: `/extract?job=${job.id}` });
    const result = await job.done;
    expect(result?.text).toBe("--- صفحہ 1 ---\nپہلا\n\n--- صفحہ 2 ---\nدوسرا");
    expect(getJob(job.id)).toMatchObject({ status: "done", current: 2, total: 2, meta: expect.objectContaining({ sessionId: "sess-9" }) });
    expect(upsertUserSession).toHaveBeenCalledWith(expect.objectContaining({ section: "ocr", userId: "u1" }));
    expect(getExtractLive(job.id)?.status).toBe("done");
    expect(stash.has(job.id)).toBe(false);
  });

  it("resumes a failed job from the pages already read", async () => {
    ocrPageImage.mockResolvedValueOnce("پہلا").mockRejectedValueOnce(new Error("OCR failed (500)"));
    const job = start();
    expect(await job.done).toBeNull();
    expect(getJob(job.id)).toMatchObject({ status: "failed", error: "OCR failed (500)" });
    expect(canResume(getJob(job.id)!)).toBe(true);

    ocrPageImage.mockResolvedValueOnce("دوسرا");
    await resumeJob(job.id);
    // Page 1 was not read (or paid for) again.
    expect(ocrPageImage).toHaveBeenCalledTimes(3);
    expect(ocrPageImage.mock.calls[2]).toEqual(["b", "image/jpeg"]);
    expect(getJob(job.id)?.status).toBe("done");
    expect(getExtractLive(job.id)?.text).toContain("دوسرا");
  });

  it("can be cancelled, and is then not resumable", async () => {
    ocrPageImage.mockImplementation(() => new Promise((r) => setTimeout(() => r("x"), 20)));
    const job = start();
    cancelJob(job.id);
    expect(await job.done).toBeNull();
    expect(getJob(job.id)).toMatchObject({ status: "cancelled", resumable: false });
  });

  it("says so when the kept file is gone", async () => {
    addJob({ id: "old", kind: "extract", title: "بیان", status: "interrupted", resumable: true, meta: { kind: "audio" } });
    await resumeJob("old");
    expect(getJob("old")).toMatchObject({ status: "failed", resumable: false });
  });
});

// Last: it reloads the modules, which would split the store the tests above share.
describe("after a restart", () => {
  it("brings a job that was running when the app closed back as interrupted", async () => {
    const saved: Job[] = [{ id: "j2", kind: "extract", title: "بیان", status: "running", current: 2, total: 5, createdAt: 1, updatedAt: 1, resumable: true }];
    localStorage.setItem("easyeditor.jobs.v1", JSON.stringify(saved));
    vi.resetModules();
    const fresh = await import("@/lib/jobs/jobStore");
    expect(fresh.getJob("j2")?.status).toBe("interrupted");
  });
});
