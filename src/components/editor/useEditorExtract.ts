import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { blockReason, detectKind } from "@/lib/extract/engine";
import { startExtractJob, getExtractLive, watchExtractLive } from "@/lib/jobs/extractJob";
import { cancelJob, markJobHandled } from "@/lib/jobs/jobStore";
import { useAuth } from "@/contexts/AuthContext";
import { useExtractGate } from "@/lib/extract/useExtractGate";
import { escapeHtml, textToHtml } from "@/lib/editor/htmlText";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";

/**
 * Extract text into the open document (SYSTEM-2026 §5): from `/متن نکالیں`
 * or by dropping a recording, scan or PDF on the editor. The text lands where
 * the cursor was — that position follows the user's own edits while the job
 * runs — under a quiet line naming the file it came from.
 *
 * The run is a queued job (SYSTEM-2026 §9): if the document is closed before
 * it finishes, the result is still saved (Files → Results) and the finish
 * notice opens it.
 */
export function useEditorExtract(editor: Editor | null) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = user?.id ?? null;
  const gate = useExtractGate();
  const available = gate.audioAvailable || gate.pagesAvailable;
  const gateRef = useRef(gate);
  gateRef.current = gate;

  const extractInto = useCallback(
    async (file: File, at?: number) => {
      if (!editor || editor.isDestroyed) return;
      const kind = detectKind(file);
      const blocked = blockReason(file, kind, gateRef.current);
      if (blocked || !kind) {
        toast.error(t(blocked ?? "extract.unsupported"));
        return;
      }

      // Keep the target position in step with edits made while the job runs.
      let pos = Math.min(at ?? editor.state.selection.to, editor.state.doc.content.size);
      const follow = ({ transaction }: { transaction: { mapping: { map: (p: number) => number } } }) => {
        pos = transaction.mapping.map(pos);
      };
      editor.on("transaction", follow);

      const job = startExtractJob({
        file, kind, language: "auto", sttRoute: gateRef.current.sttRoute, userId: userIdRef.current, pageLabel: t("extract.page", "صفحہ"),
      });
      const toastId = toast.loading(file.name, {
        action: { label: t("common.cancel", "منسوخ"), onClick: () => cancelJob(job.id) },
      });
      let shown: unknown = null;
      const stopProgress = watchExtractLive(() => {
        const p = getExtractLive(job.id)?.progress;
        if (!p || p === shown) return;
        shown = p;
        toast.loading(
          `${file.name} — ${t(p.labelKey).replace("{current}", String(p.current)).replace("{total}", String(p.total || "…"))}`,
          { id: toastId, action: { label: t("common.cancel", "منسوخ"), onClick: () => cancelJob(job.id) } },
        );
      });
      try {
        const result = await job.done;
        const live = getExtractLive(job.id);
        // This toast reports the outcome; the queue's own notice is only for a closed document.
        if (!editor.isDestroyed) markJobHandled(job.id);
        if (!result) {
          if (live?.status === "cancelled") toast.info(t("extract.cancelled"), { id: toastId });
          else toast.error(live?.error ?? t("extract.failed"), { id: toastId });
          return;
        }
        if (!result.text.trim()) {
          toast.info(t("extract.nothing_found"), { id: toastId });
          return;
        }
        if (editor.isDestroyed) {
          toast.dismiss(toastId);
          return;
        }
        const source = `<p><em>${escapeHtml(t("extract.from_file", "فائل سے: {name}").replace("{name}", file.name))}</em></p>`;
        editor.chain().focus().insertContentAt(pos, source + textToHtml(result.text)).run();
        toast.success(t("extract.inserted"), { id: toastId });
      } finally {
        stopProgress();
        editor.off("transaction", follow);
      }
    },
    [editor, t],
  );

  /** Choose a file and extract it at the cursor. */
  const pickAndExtract = useCallback(() => {
    if (!editor) return;
    const at = editor.state.selection.to;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = gateRef.current.accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void extractInto(file, at);
    };
    input.click();
  }, [editor, extractInto]);

  // A file dropped on the editor is extracted where it was dropped. Anything
  // that is not a recording, scan or PDF is left to the editor as before.
  useEffect(() => {
    if (!editor || !available) return;
    const dom = editor.view.dom;
    const onDragOver = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === "file")) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => detectKind(f));
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos;
      void extractInto(file, at);
    };
    dom.addEventListener("dragover", onDragOver);
    dom.addEventListener("drop", onDrop, true);
    return () => {
      dom.removeEventListener("dragover", onDragOver);
      dom.removeEventListener("drop", onDrop, true);
    };
  }, [editor, available, extractInto]);

  // Published for `Ctrl+K`, which lives outside the editor.
  const register = useOptionalWorkspace()?.registerEditorExtract;
  useEffect(() => {
    if (!register) return;
    register(editor && available ? pickAndExtract : null);
    return () => register(null);
  }, [register, editor, available, pickAndExtract]);

  return { extractAvailable: available, extractInto, pickAndExtract };
}
