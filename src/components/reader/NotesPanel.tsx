import React, { useState, useEffect, useCallback } from "react";
import { StickyNote, Plus, Trash2, CornerDownLeft, Loader2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { readerService } from "@/core/workspace/readerService";
import type { ReaderBookmark } from "@/core/backend/types";

interface NotesPanelProps {
  /** True when this is the active Workbench tab, so it can refresh on show. */
  active?: boolean;
}

/**
 * SPEC-M6 Phase 8 — Notes tab (Workbench).
 *
 * Per-book page notes for the Shamela reader. Reuses the reader_bookmarks
 * store (each note is a bookmark with a note text), listed newest-first for
 * the currently-open book. Clicking a note jumps the reader to its page via
 * the readerJump signal.
 */
export const NotesPanel: React.FC<NotesPanelProps> = ({ active = false }) => {
  const workspace = useOptionalWorkspace();
  const readerPage = workspace?.readerPage ?? null;

  const [notes, setNotes] = useState<ReaderBookmark[]>([]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!readerPage) {
      setNotes([]);
      return;
    }
    setLoading(true);
    try {
      const marks = await readerService.listBookmarks(readerPage.bookId);
      setNotes(marks.filter((m) => m.note).sort((a, b) => b.pageNumber - a.pageNumber));
    } catch {
      // Best-effort.
    } finally {
      setLoading(false);
    }
  }, [readerPage]);

  // Refresh when the book changes or the tab becomes visible again.
  useEffect(() => {
    load();
  }, [load, active]);

  const handleAdd = async () => {
    if (!readerPage || !draft.trim() || saving) return;
    setSaving(true);
    try {
      await readerService.addBookmark(readerPage.bookId, readerPage.pageNumber, draft.trim());
      setDraft("");
      await load();
    } catch {
      // Best-effort.
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (pageNumber: number) => {
    if (!readerPage) return;
    try {
      await readerService.removeBookmark(readerPage.bookId, pageNumber);
      await load();
    } catch {
      // Best-effort.
    }
  };

  const handleJump = (pageNumber: number) => {
    if (!readerPage) return;
    workspace?.setReaderJump({ bookId: readerPage.bookId, pageNumber });
  };

  if (!readerPage) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2 bg-background">
        <BookOpen className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          ایک کتاب کھولیں تاکہ اس کے صفحات پر نوٹس لکھے جا سکیں۔
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — which book is being annotated */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <StickyNote className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold text-foreground truncate">{readerPage.title}</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">صفحہ {readerPage.pageNumber}</p>
      </div>

      {/* Add note for the current page */}
      <div className="flex gap-1.5 p-2 border-b border-border shrink-0">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={`صفحہ ${readerPage.pageNumber} کے لیے نوٹ…`}
          className="h-8 text-xs"
          disabled={saving}
        />
        <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleAdd} disabled={saving || !draft.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Notes list */}
      <ScrollArea className="flex-1 min-h-0">
        {loading && notes.length === 0 ? (
          <div className="p-4 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : notes.length === 0 ? (
          <div className="p-4 text-[11px] text-muted-foreground leading-relaxed text-center">
            اس صفحے کے لیے کوئی نوٹ نہیں۔ اوپر والے خانے میں لکھ کر پلس دبائیں۔
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {notes.map((n) => (
              <div
                key={`${n.bookId}:${n.pageNumber}`}
                className="rounded-md border border-border/60 bg-muted/40 p-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => handleJump(n.pageNumber)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                    title="Jump to this page"
                  >
                    <CornerDownLeft className="h-3 w-3" />
                    صفحہ {n.pageNumber}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground/60 hover:text-destructive"
                    onClick={() => handleDelete(n.pageNumber)}
                    title="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[11px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
                  {n.note}
                </p>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
