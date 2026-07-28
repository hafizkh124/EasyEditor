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
import { SolvencyDialog } from "@/components/workspace/SolvencyDialog";
import { ChunkProgressBar } from "@/components/workspace/ChunkProgressBar";
import { TaskRunCard } from "@/components/workspace/TaskRunCard";
import { UnfinishedRunCard } from "@/components/workspace/UnfinishedRunCard";
import { AnnotationSheet } from "@/components/workspace/AnnotationSheet";
import type { AnnotationItem } from "@/core/workspace/annotationService";
import ResourceSearchDialog from "./ResourceSearchDialog";

interface EditorMenusAndOverlaysProps {
  editor: Editor | null;
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
  t: (k: string) => string;
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
          {!isMobile && (
            <SlashCommandMenu editor={editor} actions={aiActions} onAutoFormat={handleAutoFormat} />
          )}
          <MobileTaskSheet
            open={mobileSheetText !== null}
            onOpenChange={(open) => !open && setMobileSheetText(null)}
            selectedText={mobileSheetText ?? ""}
            aiBusy={aiBusy}
            getHandler={(slug) => {
              const map: Record<string, (() => void) | undefined> = {
                add_harakat: aiActions.onAddHarakat,
                remove_harakat: aiActions.onRemoveHarakat,
                spelling_check: aiActions.onSpellCheck,
                paraphrase: aiActions.onParaphrase,
                summarize: aiActions.onSummarize,
                citations: aiActions.onCitations,
                normalize_script: aiActions.onNormalizeScript,
                formalize: aiActions.onFormalize,
                humanize: aiActions.onHumanize,
                shorten: aiActions.onShorten,
              };
              return map[slug];
            }}
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
        <TaskRunCard summary={lastRun} onUndo={undoLastRun} onDismiss={dismissLastRun} />
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
