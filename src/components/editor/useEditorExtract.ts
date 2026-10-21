import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { blockReason, describeFailure, detectKind, runExtraction } from "@/lib/extract/engine";
import { useExtractGate } from "@/lib/extract/useExtractGate";
import { escapeHtml, textToHtml } from "@/lib/editor/htmlText";
import { logActivity } from "@/lib/activityLog";

/**
 * Extract text into the open document (SYSTEM-2026 §5): from `/متن نکالیں`
 * or by dropping a recording, scan or PDF on the editor. The text lands where
 * the cursor was — that position follows the user's own edits while the job
 * runs — under a quiet line naming the file it came from.
 */
export function useEditorExtract(editor: Editor | null) {
  const { t } = useLanguage();
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

      const controller = new AbortController();
      const toastId = toast.loading(file.name, {
        action: { label: t("common.cancel", "منسوخ"), onClick: () => controller.abort() },
      });
      try {
        const { text } = await runExtraction({
          file,
          kind,
          language: "auto",
          sttRoute: gateRef.current.sttRoute,
          signal: controller.signal,
          pageLabel: t("extract.page", "صفحہ"),
          onProgress: (p) =>
            toast.loading(
              `${file.name} — ${t(p.labelKey).replace("{current}", String(p.current)).replace("{total}", String(p.total || "…"))}`,
              { id: toastId },
            ),
        });
        if (!text.trim()) {
          toast.info(t("extract.nothing_found"), { id: toastId });
          return;
        }
        if (editor.isDestroyed) return;
        const source = `<p><em>${escapeHtml(t("extract.from_file", "فائل سے: {name}").replace("{name}", file.name))}</em></p>`;
        editor.chain().focus().insertContentAt(pos, source + textToHtml(text)).run();
        logActivity(kind === "audio" ? "stt" : "ocr", text.slice(0, 60));
        toast.success(t("extract.inserted"), { id: toastId });
      } catch (err) {
        const failure = describeFailure(err, controller.signal);
        if (!failure) toast.info(t("extract.cancelled"), { id: toastId });
        else if ("message" in failure) toast.error(failure.message, { id: toastId });
        else toast.error(failure.replace ? t(failure.key).replace(...failure.replace) : t(failure.key), { id: toastId });
      } finally {
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

  return { extractAvailable: available, extractInto, pickAndExtract };
}
