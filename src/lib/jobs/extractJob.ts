import { useSyncExternalStore } from "react";
import type { SttRoute, TranscribeLanguage } from "@/lib/audio/transcribeLongForm";
import {
  describeFailure, runExtraction,
  type ExtractKind, type ExtractProgress, type ExtractProgressSaved, type ExtractResult,
} from "@/lib/extract/engine";
import { translateStored } from "@/lib/i18n";
import { upsertUserSession } from "@/lib/userSessions";
import { logActivity } from "@/lib/activityLog";
import { addJob, getJob, newJobId, registerCancel, updateJob, type Job } from "./jobStore";
import { deleteStash, readStash, writeStash } from "./fileStash";

/**
 * Extracting text as a queued job (SYSTEM-2026 §5, §9). The run belongs to
 * the queue, not to the page that started it: the Extract screen and the
 * editor attach to it, the user can go elsewhere meanwhile, and the result is
 * saved on its own (Files → Results) when it finishes. The file and every
 * finished page or chunk are kept on the device, so after the app closes the
 * job resumes from there rather than reading — and charging for — it again.
 */

export interface ExtractJobLive {
  status: "running" | "done" | "failed" | "cancelled";
  kind: ExtractKind;
  fileName: string;
  /** The text so far, then the whole result. */
  text: string;
  progress: ExtractProgress | null;
  result: ExtractResult | null;
  /** The recording itself, for the read-along. */
  mediaFile: File | null;
  sessionId: string | null;
  error: string | null;
}

interface ExtractMeta extends Record<string, unknown> {
  kind: ExtractKind;
  language: TranscribeLanguage;
  sttRoute: SttRoute;
  fileName: string;
  userId: string | null;
  /** The word for page markers, in the UI language of the screen that started it. */
  pageLabel: string;
  sessionId?: string;
}

const live = new Map<string, ExtractJobLive>();
const liveListeners = new Set<() => void>();
const setLive = (id: string, patch: Partial<ExtractJobLive>) => {
  const prev = live.get(id);
  if (!prev) return;
  live.set(id, { ...prev, ...patch });
  liveListeners.forEach((l) => l());
};

export function getExtractLive(id: string): ExtractJobLive | undefined {
  return live.get(id);
}

/** Call `listener` whenever any extract job's live state changes. */
export function watchExtractLive(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

/** The live state of an extract job started in this visit, if any. */
export function useExtractLive(id: string | null | undefined): ExtractJobLive | undefined {
  return useSyncExternalStore(
    (l) => {
      liveListeners.add(l);
      return () => liveListeners.delete(l);
    },
    () => (id ? live.get(id) : undefined),
    () => (id ? live.get(id) : undefined),
  );
}

export interface StartExtractJob {
  file: File;
  kind: ExtractKind;
  language: TranscribeLanguage;
  sttRoute: SttRoute;
  userId: string | null;
  pageLabel: string;
}

function failureText(err: unknown, signal: AbortSignal): string | null {
  const failure = describeFailure(err, signal);
  if (!failure) return null;
  if ("message" in failure) return failure.message;
  const text = translateStored(failure.key);
  return failure.replace ? text.replace(...failure.replace) : text;
}

async function saveResult(meta: ExtractMeta, text: string): Promise<string | null> {
  if (!meta.userId || !text.trim()) return null;
  return upsertUserSession({
    id: null,
    userId: meta.userId,
    section: meta.kind === "audio" ? "transcribe" : "ocr",
    title: text.slice(0, 80),
    metadata: meta.kind === "audio"
      ? { transcript: text, originalText: "", sttLanguage: meta.language }
      : { extractedText: text },
  });
}

function run(id: string, file: File, meta: ExtractMeta, resume?: ExtractProgressSaved): Promise<ExtractResult | null> {
  const controller = new AbortController();
  registerCancel(id, () => controller.abort());
  live.set(id, {
    status: "running", kind: meta.kind, fileName: meta.fileName, text: "", progress: null, result: null,
    mediaFile: meta.kind === "audio" ? file : null, sessionId: null, error: null,
  });
  liveListeners.forEach((l) => l());

  return runExtraction({
    file,
    kind: meta.kind,
    language: meta.language,
    sttRoute: meta.sttRoute,
    signal: controller.signal,
    pageLabel: meta.pageLabel,
    resume,
    onSaved: (saved) => void writeStash(id, { progress: saved }),
    onProgress: (p) => {
      setLive(id, { progress: p, ...(p.partial ? { text: p.partial } : {}) });
      updateJob(id, { current: p.current, total: p.total });
    },
  })
    .then(async (result) => {
      if (result.text.trim()) logActivity(meta.kind === "audio" ? "stt" : "ocr", result.text.slice(0, 60));
      const sessionId = await saveResult(meta, result.text).catch(() => null);
      setLive(id, { status: "done", text: result.text, result, progress: null, sessionId });
      updateJob(id, {
        status: "done",
        meta: { ...meta, sessionId: sessionId ?? undefined },
        current: getJob(id)?.total ?? 0,
      });
      void deleteStash(id);
      return result;
    })
    .catch((err) => {
      const error = failureText(err, controller.signal);
      if (error === null) {
        setLive(id, { status: "cancelled", progress: null });
        updateJob(id, { status: "cancelled", resumable: false });
        void deleteStash(id);
      } else {
        setLive(id, { status: "failed", progress: null, error });
        updateJob(id, { status: "failed", error });
      }
      return null;
    })
    .finally(() => registerCancel(id, null));
}

/** Start extracting `file` as a queued job. `done` resolves with the result, or null. */
export function startExtractJob(input: StartExtractJob): { id: string; done: Promise<ExtractResult | null> } {
  const id = newJobId("extract");
  const meta: ExtractMeta = {
    kind: input.kind, language: input.language, sttRoute: input.sttRoute, fileName: input.file.name, userId: input.userId,
    pageLabel: input.pageLabel,
  };
  addJob({ id, kind: "extract", title: input.file.name, status: "running", href: `/extract?job=${id}`, resumable: true, meta });
  void writeStash(id, { file: input.file, fileName: input.file.name });
  return { id, done: run(id, input.file, meta) };
}

/** Pick an interrupted or failed job up again from the file and progress kept on the device. */
export async function resumeExtractJob(job: Job): Promise<void> {
  const meta = job.meta as ExtractMeta | undefined;
  const stash = await readStash(job.id);
  if (!meta || !stash?.file) {
    updateJob(job.id, { status: "failed", resumable: false, error: translateStored("jobs.file_gone", "اصل فائل اس آلے پر محفوظ نہیں رہی، دوبارہ چنیں۔") });
    return;
  }
  const file = stash.file instanceof File ? stash.file : new File([stash.file], stash.fileName ?? meta.fileName);
  updateJob(job.id, { status: "running", error: undefined });
  await run(job.id, file, meta, stash.progress as ExtractProgressSaved | undefined);
}

/** For tests. */
export function resetExtractJobsForTest(): void {
  live.clear();
}
