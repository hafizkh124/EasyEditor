import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Folder, FileText } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

export interface Chapter {
  id: string;
  project_id: string;
  title: string;
  chapter_number: number;
  synopsis?: string | null;
  sections?: Section[];
}

export interface Section {
  id: string;
  chapter_id: string;
  title: string;
  section_number: number;
  content?: string | null;
}

interface BookOutlineSidebarProps {
  chapters: Chapter[];
  activeChapterId?: string;
  activeSectionId?: string;
  onSelectChapter: (chapter: Chapter) => void;
  onSelectSection: (section: Section, chapter: Chapter) => void;
  onAddChapter: (title: string) => void;
  onAddSection: (chapterId: string, title: string) => void;
}

export function BookOutlineSidebar({
  chapters,
  activeChapterId,
  activeSectionId,
  onSelectChapter,
  onSelectSection,
  onAddChapter,
  onAddSection,
}: BookOutlineSidebarProps) {
  const { t } = useLanguage();
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [addingChapter, setAddingChapter] = useState(false);
  const [addingSectionForChapter, setAddingSectionForChapter] = useState<string | null>(null);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  const handleCreateChapter = () => {
    if (!newChapterTitle.trim()) return;
    onAddChapter(newChapterTitle.trim());
    setNewChapterTitle("");
    setAddingChapter(false);
  };

  const handleCreateSection = (chapterId: string) => {
    if (!newSectionTitle.trim()) return;
    onAddSection(chapterId, newSectionTitle.trim());
    setNewSectionTitle("");
    setAddingSectionForChapter(null);
  };

  // A fixed 18rem column leaves ~87px for the editor on a 375px screen, so on
  // phones the outline stacks above the canvas at full width with its own
  // capped height instead of competing with it for horizontal space.
  return (
    <div className="w-full md:w-72 max-h-56 md:max-h-none border-b md:border-b-0 md:border-r border-border bg-muted/60 flex flex-col md:h-full overflow-y-auto shrink-0">
      {/* Top Controls */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="text-xs font-semibold flex items-center gap-1.5">
          <Folder className="h-4 w-4 text-primary" />
          ابواب و فصول کا خاکہ
        </span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAddingChapter(true)}>
          <Plus className="h-3.5 w-3.5 ml-1" /> باب
        </Button>
      </div>

      {/* Add Chapter Inline Form */}
      {addingChapter && (
        <div className="p-3 border-b border-border bg-card space-y-2">
          <Input
            placeholder="باب کا عنوان..."
            value={newChapterTitle}
            onChange={(e) => setNewChapterTitle(e.target.value)}
            className="text-xs h-8"
          />
          <div className="flex gap-1.5 justify-end">
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setAddingChapter(false)}>منسوخ</Button>
            <Button size="sm" className="h-6 text-xs" onClick={handleCreateChapter}>شامل کریں</Button>
          </div>
        </div>
      )}

      {/* Tree View */}
      <div className="p-2 flex-1 space-y-2">
        {chapters.map((chap) => {
          const isChapActive = activeChapterId === chap.id;
          return (
            <div key={chap.id} className="space-y-1">
              <div
                onClick={() => onSelectChapter(chap)}
                className={`flex items-center justify-between p-2 rounded text-xs font-semibold cursor-pointer transition-colors ${
                  isChapActive && !activeSectionId
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-foreground"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">الباب {chap.chapter_number}: {chap.title}</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-5 w-5 opacity-70 hover:opacity-100"
                  title={t("book.add_section", "Add section")}
                  aria-label={t("book.add_section", "Add section")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddingSectionForChapter(chap.id);
                  }}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>

              {/* Sections list inside chapter */}
              <div className="pr-3 pl-1 space-y-0.5 border-r border-border/60 mr-2">
                {chap.sections?.map((sec) => {
                  const isSecActive = activeSectionId === sec.id;
                  return (
                    <div
                      key={sec.id}
                      onClick={() => onSelectSection(sec, chap)}
                      className={`flex items-center gap-1.5 p-1.5 rounded text-xs cursor-pointer transition-colors ${
                        isSecActive
                          ? "bg-primary/15 text-primary font-medium border-r-2 border-primary"
                          : "hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      <FileText className="h-3 w-3 shrink-0" />
                      <span className="truncate">فصل {sec.section_number}: {sec.title}</span>
                    </div>
                  );
                })}

                {/* Inline Add Section Form */}
                {addingSectionForChapter === chap.id && (
                  <div className="p-1.5 space-y-1 bg-card rounded border border-border">
                    <Input
                      placeholder="فصل کا عنوان..."
                      value={newSectionTitle}
                      onChange={(e) => setNewSectionTitle(e.target.value)}
                      className="text-xs h-7"
                    />
                    <div className="flex gap-1 justify-end">
                      <Button size="sm" variant="ghost" className="h-5 text-xs" onClick={() => setAddingSectionForChapter(null)}>منسوخ</Button>
                      <Button size="sm" className="h-5 text-xs" onClick={() => handleCreateSection(chap.id)}>افزود</Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
