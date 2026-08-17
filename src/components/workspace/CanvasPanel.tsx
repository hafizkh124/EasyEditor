import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, BookOpen, X } from "lucide-react";
import RichEditor, { type DocChangePayload } from "@/components/editor/RichEditor";
import { Button } from "@/components/ui/button";
import { SelectionActionBar } from "./SelectionActionBar";
import { CanvasTranslationView } from "./CanvasTranslationView";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { hasSeenWorkspaceHint, dismissWorkspaceHint } from "@/lib/onboarding";
import type { Document } from "@/core/workspace/types";

interface CanvasPanelProps {
  doc: Document | null;
  docLoading: boolean;
  contentRevision: number;
  restoredContent: Record<string, unknown> | null;
  initialContent?: string;
  onEditorChange?: (html: string, text: string) => void;
  onDocChange?: (payload: DocChangePayload) => void;
  /** Persist an explicit direction the author chose for this document. */
  onDirectionChange?: (direction: "rtl" | "ltr") => void;
}

export const CanvasPanel: React.FC<CanvasPanelProps> = ({
  doc,
  docLoading,
  contentRevision,
  restoredContent,
  initialContent,
  onEditorChange,
  onDocChange,
  onDirectionChange,
}) => {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const { pendingCanvasInsertion, clearPendingCanvasInsertion } = useWorkspace();
  const [showHint, setShowHint] = useState(() => !hasSeenWorkspaceHint());

  const isTranslationView = searchParams.get("view") === "translation";

  // "Dismissed on use" (UX-v1 P6): opening any document at all is the signal
  // that the user found their way in, so the hint never needs to show again —
  // not just for this session, but persisted the same way the dismiss button
  // below does it.
  useEffect(() => {
    if (doc) dismissWorkspaceHint();
  }, [doc]);

  const dismissHint = () => {
    dismissWorkspaceHint();
    setShowHint(false);
  };

  if (docLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 bg-background text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary mb-2" />
        <p className="text-xs">{t("common.loading", "Loading document...")}</p>
      </div>
    );
  }

  if (isTranslationView && doc) {
    return <CanvasTranslationView documentId={doc.id} projectId={doc.project_id} documentTitle={doc.title} />;
  }

  // SPEC-M6: Show a welcoming empty state when no document is selected
  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground px-4">
        {/* UX-v1 P6 — a dismissible 2-step hint for a genuinely first-time
            user, not a product tour: shown once, gone for good once a
            document is opened or the user closes it themselves. */}
        {showHint && (
          <div className="relative mb-6 w-full max-w-xs rounded-lg border border-primary/30 bg-primary/5 p-4 text-start">
            <Button
              variant="ghost"
              size="icon"
              className="absolute end-1.5 top-1.5 h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={dismissHint}
              aria-label={t("canvas.hint_dismiss", "Dismiss")}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            <ol className="space-y-2 text-sm text-foreground">
              <li className="flex gap-2">
                <span className="shrink-0 font-semibold text-primary">{t("canvas.hint_step1_num", "1")}</span>
                <span>{t("canvas.hint_step1", "Create a new project in the Library")}</span>
              </li>
              <li className="flex gap-2">
                <span className="shrink-0 font-semibold text-primary">{t("canvas.hint_step2_num", "2")}</span>
                <span>{t("canvas.hint_step2", "Start writing here — research stays alongside")}</span>
              </li>
            </ol>
          </div>
        )}
        <BookOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-muted-foreground/70 mb-1">
          {t("common.app_name", "Easy Editor")}
        </h2>
        <p className="text-sm text-muted-foreground/50">
          {t("canvas.empty_hint", "Select a book from the Library to start reading")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      {/* Editor Content Area */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-4xl mx-auto w-full">
        <RichEditor
          initialContent={initialContent}
          contentJson={restoredContent ?? doc?.content_json}
          contentRevision={contentRevision}
          textDirection={doc?.text_direction ?? null}
          // Routed up to `useDocument.updateDirection` rather than calling the
          // service straight from here: that keeps the in-memory `doc` in step
          // with the row, so a direct service call cannot leave the editor
          // reading a stale direction for the rest of the session.
          onTextDirectionChange={onDirectionChange}
          placeholder={t("editor.placeholder", "شروعات کے لیے کچھ لکھیں یا ریسرچ ورک بینچ سے مواد لائیں...")}
          onChange={onEditorChange}
          onDocChange={onDocChange}
          pendingInsertHtml={pendingCanvasInsertion}
          onInsertHandled={clearPendingCanvasInsertion}
          selectionBar={({ selectedText, isBusy, actions }) => (
            <SelectionActionBar selectedText={selectedText} isBusy={isBusy} {...actions} />
          )}
        />
      </div>
    </div>
  );
};
