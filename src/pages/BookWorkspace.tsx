import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BookOpen, Plus, Sparkles, ArrowLeft, Download
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { BookOutlineSidebar, type Chapter, type Section } from "@/components/book/BookOutlineSidebar";
import { BookEditorView } from "@/components/book/BookEditorView";
import { KhittatBahthModal } from "@/components/book/KhittatBahthModal";
import { BookExportModal } from "@/components/book/BookExportModal";

interface BookProject {
  id: string;
  title: string;
  subtitle?: string | null;
  genre: string;
  abstract?: string | null;
  status: string; // 'idea' | 'outline' | 'draft' | 'review' | 'final'
  target_word_count?: number | null;
  current_word_count?: number | null;
  created_at: string;
}

export default function BookWorkspace() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [_projects, setProjects] = useState<BookProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<BookProject | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [activeSection, setActiveSection] = useState<Section | null>(null);

  const [_loading, setLoading] = useState(false);
  const [newBookModal, setNewBookModal] = useState(false);
  const [khittatModal, setKhittatModal] = useState(false);
  const [exportModal, setExportModal] = useState(false);

  // New Book Form
  const [newTitle, setNewTitle] = useState("");
  const [newSubtitle, setNewSubtitle] = useState("");
  const [newGenre] = useState("research");
  // Outline produced by the خطة البحث modal, consumed by handleCreateBookProject.
  const [pendingPlan, setPendingPlan] = useState<{ abstract: string; chapters: string[] } | null>(null);

  useEffect(() => {
    loadBookProjects();
  }, []);

  const loadBookProjects = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("book_projects")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setProjects(data || []);
      if (data && data.length > 0 && !selectedProject) {
        selectBookProject(data[0]);
      }
    } catch (err) {
      console.error(err);
      toast.error("کتابی پروجیکٹس حاصل کرنے میں ناکامی۔");
    } finally {
      setLoading(false);
    }
  };

  const selectBookProject = async (proj: BookProject) => {
    setSelectedProject(proj);
    setLoading(true);
    try {
      // Fetch chapters and child sections
      const { data: chapData, error: cErr } = await supabase
        .from("book_chapters")
        .select("*")
        .eq("project_id", proj.id)
        .order("chapter_number", { ascending: true });

      if (cErr) throw cErr;

      const loadedChapters: Chapter[] = [];
      for (const ch of chapData || []) {
        const { data: secData } = await supabase
          .from("book_sections")
          .select("*")
          .eq("chapter_id", ch.id)
          .order("section_number", { ascending: true });

        loadedChapters.push({
          ...ch,
          sections: secData || [],
        });
      }

      setChapters(loadedChapters);
      if (loadedChapters.length > 0) {
        setActiveChapter(loadedChapters[0]);
        if (loadedChapters[0].sections && loadedChapters[0].sections.length > 0) {
          setActiveSection(loadedChapters[0].sections[0]);
        } else {
          setActiveSection(null);
        }
      } else {
        setActiveChapter(null);
        setActiveSection(null);
      }
    } catch (err) {
      console.error(err);
      toast.error("ابواب و فصول کا خاکہ حاصل نہ ہو سکا۔");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBookProject = async () => {
    if (!newTitle.trim()) {
      toast.error("کتاب کا عنوان درج کریں۔");
      return;
    }
    try {
      const { data: proj, error: pErr } = await supabase
        .from("book_projects")
        .insert({
          user_id: session!.user.id,
          title: newTitle.trim(),
          subtitle: newSubtitle.trim() || null,
          genre: newGenre,
          status: "outline",
        })
        .select()
        .single();

      if (pErr) throw pErr;

      // Seed initial chapter & section
      const { data: chap, error: cErr } = await supabase
        .from("book_chapters")
        .insert({
          project_id: proj.id,
          title: "المقدمة والمدخل الرئيسي",
          chapter_number: 1,
        })
        .select()
        .single();

      if (cErr) throw cErr;

      await supabase.from("book_sections").insert({
        chapter_id: chap.id,
        title: "تمهيد وفهرس المباحث",
        section_number: 1,
        content: "بسم الله الرحمن الرحيم\n\nتأليف وتمهيد...",
      });

      toast.success("نیا کتابی تصنیف پروجیکٹ شروع ہو گیا۔");
      setNewBookModal(false);
      setNewTitle("");
      setNewSubtitle("");
      await loadBookProjects();
      selectBookProject(proj);
    } catch (err) {
      console.error(err);
      toast.error("پروجیکٹ کی تخلیق میں ناکامی۔");
    }
  };

  const handleAddChapter = async (title: string) => {
    if (!selectedProject) return;
    try {
      const nextNum = chapters.length + 1;
      const { data, error } = await supabase
        .from("book_chapters")
        .insert({
          project_id: selectedProject.id,
          title,
          chapter_number: nextNum,
        })
        .select()
        .single();

      if (error) throw error;

      const newChap: Chapter = { ...data, sections: [] };
      setChapters((prev) => [...prev, newChap]);
      setActiveChapter(newChap);
      toast.success(`باب #${nextNum} شامل ہو گیا۔`);
    } catch (err) {
      console.error(err);
      toast.error("باب کی شمولیت میں ناکامی۔");
    }
  };

  const handleAddSection = async (chapterId: string, title: string) => {
    try {
      const chap = chapters.find((c) => c.id === chapterId);
      const nextNum = (chap?.sections?.length || 0) + 1;
      const { data, error } = await supabase
        .from("book_sections")
        .insert({
          chapter_id: chapterId,
          title,
          section_number: nextNum,
          content: "",
        })
        .select()
        .single();

      if (error) throw error;

      setChapters((prev) =>
        prev.map((c) => (c.id === chapterId ? { ...c, sections: [...(c.sections || []), data] } : c))
      );
      setActiveSection(data);
      toast.success(`فصل #${nextNum} شامل ہو گئی۔`);
    } catch (err) {
      console.error(err);
      toast.error("فصل کی شمولیت میں ناکامی۔");
    }
  };

  const handleSaveSectionContent = async (newContent: string) => {
    if (!activeSection) return;
    const { error } = await supabase
      .from("book_sections")
      .update({
        content: newContent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeSection.id);

    if (error) throw error;
    setActiveSection((prev) => (prev ? { ...prev, content: newContent } : null));

    // Recalculate book word count
    const totalWords = chapters.reduce((sum, c) => {
      return (
        sum +
        (c.sections?.reduce((sSum, sec) => {
          const text = sec.id === activeSection.id ? newContent : sec.content || "";
          return sSum + (text.trim() ? text.trim().split(/\s+/).length : 0);
        }, 0) || 0)
      );
    }, 0);

    if (selectedProject) {
      await supabase
        .from("book_projects")
        .update({ current_word_count: totalWords })
        .eq("id", selectedProject.id);
      setSelectedProject((prev) => (prev ? { ...prev, current_word_count: totalWords } : null));
    }
  };

  const fullBookContent = chapters
    .map((c) => `=== الباب ${c.chapter_number}: ${c.title} ===\n\n` + (c.sections?.map((s) => `--- فصل: ${s.title} ---\n${s.content || ""}`).join("\n\n") || ""))
    .join("\n\n\n");

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem-4rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <BookOpen className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-base font-semibold">تصنیف ورک اسپیس (Book Authoring Studio)</h1>
              <p className="text-xs text-muted-foreground">خطة البحث، ابواب و فصول، اور صفحہ بہ صفحہ کتاب ساز</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setKhittatModal(true)}>
              <Sparkles className="h-4 w-4 ml-1.5 text-primary" />
              خطة البحث والتأليف
            </Button>
            <Button size="sm" variant="outline" onClick={() => setExportModal(true)}>
              <Download className="h-4 w-4 ml-1.5" />
              ایکسپورٹ
            </Button>
            <Button size="sm" onClick={() => setNewBookModal(true)}>
              <Plus className="h-4 w-4 ml-1.5" />
              نئی کتاب
            </Button>
          </div>
        </div>

        {/* Studio Canvas */}
        <div className="flex-1 flex overflow-hidden">
          {/* Projects Quick Picker & Outline Sidebar */}
          <BookOutlineSidebar
            chapters={chapters}
            activeChapterId={activeChapter?.id}
            activeSectionId={activeSection?.id}
            onSelectChapter={(chap) => {
              setActiveChapter(chap);
              if (chap.sections && chap.sections.length > 0) setActiveSection(chap.sections[0]);
            }}
            onSelectSection={(sec, chap) => {
              setActiveChapter(chap);
              setActiveSection(sec);
            }}
            onAddChapter={handleAddChapter}
            onAddSection={handleAddSection}
          />

          {/* Writing Area Canvas */}
          {selectedProject && activeSection ? (
            <BookEditorView
              sectionId={activeSection.id}
              chapterTitle={activeChapter?.title || "الباب"}
              sectionTitle={activeSection.title}
              initialContent={activeSection.content || ""}
              onSaveContent={handleSaveSectionContent}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-muted-foreground">
              <div>
                <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-40 text-primary" />
                <h3 className="text-base font-semibold mb-1">کوئی فصل منتخب نہیں ہوئی</h3>
                <p className="text-xs max-w-sm mb-4">نئی فصل بنائیں یا سائیڈ بار سے خاکہ منتخب کریں۔</p>
                <Button onClick={() => setNewBookModal(true)}>نئی کتاب بنائیں</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Book Dialog */}
      <Dialog open={newBookModal} onOpenChange={setNewBookModal}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>نیا تصنیفی پروجیکٹ بنائیں</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>کتاب کا عنوان</Label>
              <Input placeholder="مثلاً: أنوار التنزيل وأسرار التأويل" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>ذیلی عنوان (Subtitle)</Label>
              <Input placeholder="مثلاً: دراسة فقهية حديثية مقارنة" value={newSubtitle} onChange={(e) => setNewSubtitle(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNewBookModal(false)}>منسوخ</Button>
            <Button onClick={handleCreateBookProject}>پروجیکٹ بنائیں</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Khittat Bahth Modal */}
      <KhittatBahthModal
        open={khittatModal}
        onOpenChange={setKhittatModal}
        onApplyPlan={async (plan) => {
          setNewTitle(plan.title);
          setNewBookModal(true);
        }}
      />

      {/* Export Modal */}
      <BookExportModal
        open={exportModal}
        onOpenChange={setExportModal}
        bookTitle={selectedProject?.title || "کتاب"}
        fullContent={fullBookContent}
      />
    </AppLayout>
  );
}
