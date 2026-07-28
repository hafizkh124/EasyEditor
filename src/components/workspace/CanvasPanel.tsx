import React from "react";
import { Loader2 } from "lucide-react";
import RichEditor, { type DocChangePayload } from "@/components/editor/RichEditor";
import { SelectionActionBar } from "./SelectionActionBar";
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
  const { pendingCanvasInsertion, clearPendingCanvasInsertion } = useWorkspace();

  if (docLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 bg-background text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
        <p className="text-xs">Loading document...</p>
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
