import { useSyncExternalStore } from "react";

/**
 * The one queue of long jobs (SYSTEM-2026 §9): a long transcription, OCR of
 * many pages, a book translation, a large agent task. Jobs run inside the app
 * but apart from the page that started them, so the user can do other work;
 * the strip at the bottom of the sidebar (Home on a phone) shows them.
 *
 * Only the jobs' descriptions live here, kept in localStorage so the list
 * survives closing the app. A job that was running when the app closed comes
 * back "interrupted" and, where its runner can, resumes from what it saved
 * (see `fileStash.ts`). The work itself belongs to each job's runner.
 */

export type JobKind = "extract" | "translate" | "agent";

/** "approval": waiting for the user (agent). "review": finished, its result waits to be looked at. */
export type JobStatus = "running" | "approval" | "review" | "done" | "failed" | "interrupted" | "cancelled";

export interface Job {
  id: string;
  kind: JobKind;
  title: string;
  status: JobStatus;
  /** Progress in the job's own units (pages, chunks); total 0 = unknown yet. */
  current: number;
  total: number;
  createdAt: number;
  updatedAt: number;
  /** Where the job's result (or its page) opens. */
  href?: string;
  error?: string;
  /** Whether "Resume" can pick the job up again after an interruption or failure. */
  resumable?: boolean;
  /** Runner-specific settings needed to resume (language, project id…). */
  meta?: Record<string, unknown>;
}

const STORAGE_KEY = "easyeditor.jobs.v1";
const KEEP = 30;
const ACTIVE: ReadonlySet<JobStatus> = new Set(["running", "approval"]);

export function isActive(job: Job): boolean {
  return ACTIVE.has(job.status);
}

const NEEDS_USER: ReadonlySet<JobStatus> = new Set(["approval", "failed", "interrupted", "review"]);

/** Waiting on the user: an approval, a result to review, or a stopped job to resume. */
export function needsUser(job: Job): boolean {
  return NEEDS_USER.has(job.status);
}

/** Finished jobs stay on the strip this long, then only until cleared. */
const RECENT_MS = 10 * 60 * 1000;

/** What the jobs strip shows: everything running or waiting, and what finished just now. */
export function visibleJobs(list: readonly Job[], now = Date.now()): Job[] {
  return list.filter((j) => isActive(j) || needsUser(j) || now - j.updatedAt < RECENT_MS);
}

function load(): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as Job[]) : [];
    if (!Array.isArray(list)) return [];
    // Nothing runs across a restart: whatever was running stopped with the app.
    return list.map((j) => (isActive(j) ? { ...j, status: "interrupted" as const } : j));
  } catch {
    return [];
  }
}

let jobs: Job[] = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, KEEP)));
  } catch { /* the list stays in memory */ }
}

function emit() {
  persist();
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getJobs(): readonly Job[] {
  return jobs;
}

export function getJob(id: string): Job | undefined {
  return jobs.find((j) => j.id === id);
}

export function newJobId(kind: JobKind): string {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addJob(job: Omit<Job, "createdAt" | "updatedAt" | "current" | "total"> & Partial<Pick<Job, "current" | "total">>): Job {
  const now = Date.now();
  const full: Job = { current: 0, total: 0, ...job, createdAt: now, updatedAt: now };
  jobs = [full, ...jobs.filter((j) => j.id !== job.id)].slice(0, KEEP);
  emit();
  return full;
}

export function updateJob(id: string, patch: Partial<Omit<Job, "id" | "kind" | "createdAt">>): void {
  const prev = getJob(id);
  if (!prev) return;
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  jobs = jobs.map((j) => (j.id === id ? next : j));
  emit();
  if (isActive(prev) && !isActive(next)) for (const h of finishHandlers) h(next);
}

export function removeJob(id: string): void {
  jobs = jobs.filter((j) => j.id !== id);
  emit();
}

/** Clear the finished jobs off the list (done, cancelled, reviewed). */
export function clearFinished(): void {
  jobs = jobs.filter((j) => isActive(j) || j.status === "failed" || j.status === "interrupted" || j.status === "review");
  emit();
}

export function useJobs(): readonly Job[] {
  return useSyncExternalStore(subscribe, getJobs, getJobs);
}

export function useJob(id: string | null | undefined): Job | undefined {
  const all = useJobs();
  return id ? all.find((j) => j.id === id) : undefined;
}

// ── Cancel and resume ────────────────────────────────────────────────────

const cancels = new Map<string, () => void>();

/** A running job's stop button. Cleared when the job stops. */
export function registerCancel(id: string, cancel: (() => void) | null): void {
  if (cancel) cancels.set(id, cancel);
  else cancels.delete(id);
}

export function canCancel(id: string): boolean {
  return cancels.has(id);
}

export function cancelJob(id: string): void {
  cancels.get(id)?.();
}

type Resumer = (job: Job) => void | Promise<void>;
const resumers = new Map<JobKind, Resumer>();

/** Each job kind says how to pick its jobs up again; registered when its runner loads. */
export function registerResumer(kind: JobKind, resume: Resumer): void {
  resumers.set(kind, resume);
}

export function canResume(job: Job): boolean {
  return Boolean(job.resumable) && (job.status === "interrupted" || job.status === "failed") && resumers.has(job.kind);
}

export async function resumeJob(id: string): Promise<void> {
  const job = getJob(id);
  if (!job || !canResume(job)) return;
  await resumers.get(job.kind)?.(job);
}

// A job's page, opened from outside React (a resumer). Set by JobNotices, inside the router.
type JobNavigate = (href: string, state?: unknown) => void;
let jobNavigate: JobNavigate | null = null;

export function setJobNavigator(navigate: JobNavigate | null): void {
  jobNavigate = navigate;
}

export function openJobPage(href: string, state?: unknown): void {
  jobNavigate?.(href, state);
}

// ── Finishing ────────────────────────────────────────────────────────────

const finishHandlers = new Set<(job: Job) => void>();

/** Called once when a job stops running (done, failed, cancelled…) — for the notice. */
export function onJobFinished(handler: (job: Job) => void): () => void {
  finishHandlers.add(handler);
  return () => finishHandlers.delete(handler);
}

const handled = new Set<string>();

/**
 * The screen that started a job showed its result itself (the editor inserted
 * the text), so the finish notice is not needed. Call right after the job ends.
 */
export function markJobHandled(id: string): void {
  handled.add(id);
}

export function wasJobHandled(id: string): boolean {
  return handled.has(id);
}

// ── Live events, for a page that re-opens a running job ──────────────────

const eventListeners = new Map<string, Set<(event: unknown) => void>>();

export function emitJobEvent(id: string, event: unknown): void {
  eventListeners.get(id)?.forEach((l) => l(event));
}

export function onJobEvent<E>(id: string, listener: (event: E) => void): () => void {
  let set = eventListeners.get(id);
  if (!set) eventListeners.set(id, (set = new Set()));
  set.add(listener as (event: unknown) => void);
  return () => set!.delete(listener as (event: unknown) => void);
}

/** For tests: start from an empty queue. */
export function resetJobsForTest(list: Job[] = []): void {
  jobs = list;
  cancels.clear();
  finishHandlers.clear();
  eventListeners.clear();
  emit();
}
