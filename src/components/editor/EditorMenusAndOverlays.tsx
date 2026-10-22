import React from "react";
import type { Editor } from "@tiptap/react";
import type { TaskRun } from "@/core/workspace/types";
import type { ChunkedRunProgress } from "@/lib/tasks/chunkOrchestrator";
import type { LastRunSummary } from "@/components/workspace/TaskRunCard";
import type { TextBatch } from "@/lib/editor/docChunker";
import type { SelectionBarActions } from "./useEditorAiActions";
import { FloatingBubbleMenu } from "./FloatingBubbleMenu";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { MobileTaskSheet } from "./MobileTaskSheet";
import { getActionHandler } from "./bubbleMenuTasks";
import { RecipeRunDialog } from "@/components/workspace/RecipeRunDialog";
import type { Recipe } from "@/lib/recipes/recipeService";
import { SolvencyDialog } from "@/components/workspace/SolvencyDialog";
import { ChunkProgressBar } from "@/components/workspace/ChunkProgressBar";
import { TaskRunCard } from "@/components/workspace/TaskRunCard";
import { UnfinishedRunCard } from "@/components/workspace/UnfinishedRunCard";
import { AnnotationSheet } from "@/components/workspace/AnnotationSheet";
import type { AnnotationItem } from "@/core/workspace/annotationService";
import ResourceSearchDialog from "./ResourceSearchDialog";
import { CitationFootnotesDialog } from "./CitationFootnotesDialog";
import { isDesktop } from "@/utils/environment";
import { stripSuggestions } from "@/lib/editor/exporters";

interface EditorMenusAndOverlaysProps {
  editor: Editor | null;
  /** "Extract text here" — choose a file whose text goes in at the cursor. */
  onExtract?: () => void;
  menusEnabled: boolean;
  isMobile: boolean;
  aiActions: SelectionBarActions;
  aiBusy: string | null;
  mobileSheetText: string | null;
  setMobileSheetText: (text: string | null) => void;
  handleAutoFormat: () => void;
  pendingChunkedRun: {
    taskLabel: string;
    batches: TextBatch[];
    totalCost: number;
  } | null;
  dismissChunkedRun: () => void;
  confirmChunkedRun: () => void;
  availableTokens?: number;
  chunkProgress: ChunkedRunProgress | null;
  cancelChunkedRun: () => void;
  lastRun: LastRunSummary | null;
  undoLastRun: () => void;
  dismissLastRun: () => void;
  incompleteRun: TaskRun | null;
  canResumeIncompleteRun: boolean;
  resumeIncompleteRun: () => void;
  discardIncompleteRun: () => void;
  resourceOpen: boolean;
  setResourceOpen: (open: boolean) => void;
  handleInsertResource: (text: string, citation: string) => void;
  selectionBar?: (args: { selectedText: string; isBusy: boolean; actions: SelectionBarActions }) => React.ReactNode;
  selectionUi?: { text: string; top: number; left: number; below: boolean } | null;
  /** Margin notes (FR-1.3). Absent when the annotations flag is off. */
  annotations?: {
    items: AnnotationItem[];
    hasSelection: boolean;
    onCreate: (note: string) => void;
    onDelete: (id: string) => void;
  };
  t: import("@/lib/i18n").Translator;
}

export const EditorMenusAndOverlays: React.FC<EditorMenusAndOverlaysProps> = ({
  editor,
  menusEnabled,
  isMobile,
  aiActions,
  aiBusy,
  mobileSheetText,
  setMobileSheetText,
  handleAutoFormat,
  onExtract,
  pendingChunkedRun,
  dismissChunkedRun,
  confirmChunkedRun,
  availableTokens,
  chunkProgress,
  cancelChunkedRun,
  lastRun,
  undoLastRun,
  dismissLastRun,
  incompleteRun,
  canResumeIncompleteRun,
  resumeIncompleteRun,
  discardIncompleteRun,
  resourceOpen,
  setResourceOpen,
  handleInsertResource,
  selectionBar,
  selectionUi,
  annotations,
  t,
}) => {
  const [footnotesOpen, setFootnotesOpen] = React.useState(false);
  const [recipeToRun, setRecipeToRun] = React.useState<Recipe | null>(null);
  const canFootnoteExport =
    isDesktop() &&
    Boolean(typeof window !== "undefined" && window.electronAPI?.docBridge?.applyCitations) &&
    Boolean(editor) &&
    (lastRun?.sources.length ?? 0) > 0;

  return (
    <>
      {menusEnabled && editor && (
        <>
          <FloatingBubbleMenu
            editor={editor}
            actions={aiActions}
            aiBusy={aiBusy}
            isMobile={isMobile}
            onOpenMobileSheet={setMobileSheetText}
          />
          {/* "/" on phones too (same features everywhere, SYSTEM-2026 §1): skills,
              recipes and "extract text here" had no other way in there. */}
          <SlashCommandMenu
            editor={editor} actions={aiActions} onAutoFormat={handleAutoFormat}
            onRunRecipe={setRecipeToRun} onExtract={onExtract} isMobile={isMobile}
          />
          <RecipeRunDialog recipe={recipeToRun} onClose={() => setRecipeToRun(null)} />
          <MobileTaskSheet
            open={mobileSheetText !== null}
            onOpenChange={(open) => !open && setMobileSheetText(null)}
            selectedText={mobileSheetText ?? ""}
            aiBusy={aiBusy}
            getHandler={(slug) => getActionHandler(aiActions, slug)}
          />
        </>
      )}

      {!menusEnabled && selectionBar && selectionUi && (
        <div
          className="absolute z-40"
          style={{
            top: selectionUi.top,
            left: selectionUi.left,
            transform: `translate(-50%, ${selectionUi.below ? "0" : "-100%"})`,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {selectionBar({
            selectedText: selectionUi.text,
            isBusy: aiBusy !== null,
            actions: aiActions,
          })}
        </div>
      )}

      {pendingChunkedRun && (
        <SolvencyDialog
          open
          onOpenChange={(open) => {
            if (!open) dismissChunkedRun();
          }}
          taskLabel={pendingChunkedRun.taskLabel}
          totalChunks={pendingChunkedRun.batches.length}
          totalCost={pendingChunkedRun.totalCost}
          availableTokens={availableTokens ?? 0}
          onConfirm={confirmChunkedRun}
        />
      )}

      {chunkProgress && <ChunkProgressBar progress={chunkProgress} onCancel={cancelChunkedRun} />}

      {!chunkProgress && incompleteRun && (
        <UnfinishedRunCard
          run={incompleteRun}
          canResume={canResumeIncompleteRun}
          onResume={resumeIncompleteRun}
          onDiscard={discardIncompleteRun}
        />
      )}

      {!chunkProgress && !incompleteRun && lastRun && (
        <TaskRunCard
          summary={lastRun}
          onUndo={undoLastRun}
          onDismiss={dismissLastRun}
          onExportFootnotes={canFootnoteExport ? () => setFootnotesOpen(true) : undefined}
        />
      )}

      {canFootnoteExport && editor && lastRun && (
        <CitationFootnotesDialog
          open={footnotesOpen}
          onOpenChange={setFootnotesOpen}
          html={stripSuggestions(editor.getHTML())}
          text={editor.getText()}
          sources={lastRun.sources}
          title={editor.getText().trim().split("\n")[0]?.slice(0, 60) || t("editor.untitled", "Untitled")}
        />
      )}

      {annotations && (
        <div className="border-t border-border px-2 py-1 flex items-center">
          <AnnotationSheet
            annotations={annotations.items}
            hasSelection={annotations.hasSelection}
            onCreateAnnotation={annotations.onCreate}
            onDeleteAnnotation={annotations.onDelete}
          />
        </div>
      )}

      <ResourceSearchDialog
        open={resourceOpen}
        onOpenChange={setResourceOpen}
        onInsert={handleInsertResource}
        t={t}
      />
    </>
  );
};
