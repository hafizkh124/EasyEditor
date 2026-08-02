import React from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, BookOpen } from "lucide-react";
import RichEditor, { type DocChangePayload } from "@/components/editor/RichEditor";
import { SelectionActionBar } from "./SelectionActionBar";
import { CanvasTranslationView } from "./CanvasTranslationView";
import { useWorkspace } from "@/core/workspace/WorkspaceContext";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Document } from "@/core/workspace/types";

interface CanvasPanelProps {
  doc: Document | null;
  docLoading: boolean;
  contentRevision: number;
  restoredContent: Record<string, unknown> | null;
  initialContent?: string;
  onEditorChange?: (html: string, text: string) => void;
  onDocChange?: (payload: DocChangePayload) => void;
}

export const CanvasPanel: React.FC<CanvasPanelProps> = ({
  doc,
  docLoading,
  contentRevision,
  restoredContent,
  initialContent,
  onEditorChange,
  onDocChange,
}) => {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const { pendingCanvasInsertion, clearPendingCanvasInsertion } = useWorkspace();

  const isTranslationView = searchParams.get("view") === "translation";

  if (docLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
        <p className="text-xs">Loading document...</p>
      </div>
    );
  }

  if (isTranslationView) {
    return <CanvasTranslationView />;
  }

  // SPEC-M6: Show a welcoming empty state when no document is selected
  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground">
        <BookOpen className="h-16 w-16 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold text-muted-foreground/70 mb-1">
          Easy Editor
        </h2>
        <p className="text-sm text-muted-foreground/50">
          Select a book from the Library to start reading
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
          placeholder={t("editor.placeholder") || "شروعات کے لیے کچھ لکھیں یا ریسرچ ورک بینچ سے مواد لائیں..."}
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
