import { openJobPage, registerResumer } from "./jobStore";

/**
 * How each kind of queued job is picked up again (SYSTEM-2026 §9). Kept light
 * — the runners themselves (the PDF reader, the translator) load only when a
 * job actually resumes — because the jobs strip that offers "Resume" is on
 * every screen.
 */

// Extraction resumes in place, from the file and pages kept on the device.
registerResumer("extract", async (job) => {
  const { resumeExtractJob } = await import("./extractJob");
  await resumeExtractJob(job);
});

// A translation resumes on its own page, which carries on from the first
// untranslated page once the book is loaded again.
registerResumer("translate", (job) => {
  if (job.href) openJobPage(job.href, { continueJob: job.id });
});
