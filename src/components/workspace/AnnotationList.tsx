import React, { useState } from "react";
import { StickyNote, Trash2, Link2Off, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { AnnotationItem } from "@/core/workspace/annotationService";

interface AnnotationListProps {
  annotations: AnnotationItem[];
  onCreateAnnotation?: (note: string) => void;
  onDeleteAnnotation: (id: string) => void;
  hasSelection?: boolean;
}

export const AnnotationList: React.FC<AnnotationListProps> = ({
  annotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  hasSelection,
}) => {
  const [newNote, setNewNote] = useState("");

  const handleAdd = () => {
    if (!newNote.trim() || !onCreateAnnotation) return;
    onCreateAnnotation(newNote.trim());
    setNewNote("");
  };

  return (
    <div className="flex flex-col h-full bg-background p-3" dir="rtl">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
        <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-700 dark:text-amber-400">
          <StickyNote className="h-4 w-4" />
          <span>حاشیہ نوٹس ({annotations.length})</span>
        </div>
      </div>

      {hasSelection && onCreateAnnotation && (
        <div className="space-y-1.5 mb-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
          <p className="text-[11px] text-amber-700 font-medium">منتخب متن پر نوٹ شامل کریں:</p>
          <div className="flex gap-1">
            <Input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="نوٹ لکھیں…"
              className="h-7 text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <Button size="sm" className="h-7 px-2 text-xs gap-1 bg-amber-600 hover:bg-amber-700" onClick={handleAdd}>
              <Plus className="h-3 w-3" />
              لگائیں
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 pe-2">
        {annotations.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">کوئی حاشیہ نوٹ موجود نہیں۔</p>
        ) : (
          <div className="space-y-2">
            {annotations.map((item) => {
              const isDetached = item.anchor?.isDetached;
              return (
                <div
                  key={item.id}
                  className={`p-2 rounded-md border text-xs space-y-1 ${
                    isDetached
                      ? "bg-muted/40 border-muted-foreground/30 text-muted-foreground"
                      : "bg-amber-500/5 border-amber-500/20 text-foreground"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <p className="font-medium text-xs break-words">{item.note}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => onDeleteAnnotation(item.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>

                  {item.anchor?.quote && (
                    <blockquote className="border-r-2 border-amber-500/40 pe-1.5 text-[11px] italic text-muted-foreground truncate">
                      "{item.anchor.quote}"
                    </blockquote>
                  )}

                  {isDetached && (
                    <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground border-muted-foreground/30">
                      <Link2Off className="h-2.5 w-2.5" />
                      منقطع نوٹ (متن تبدیل ہو گیا)
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
};
