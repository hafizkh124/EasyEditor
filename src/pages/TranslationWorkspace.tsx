import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Languages, Plus, BookOpen, Sparkles, Check, Copy, ArrowLeft, Loader2,
  BookmarkCheck, HelpCircle, Layers, FileEdit, Save, RefreshCw, FileText
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { lookupTranslationMemory, GENRE_TRANSLATION_PROMPTS, type TranslationMemoryMatch } from "@/lib/translationMemory";
import { isRtlText } from "@/utils/textUtils";
import { collectSseText } from "@/lib/sse";

interface Project {
  id: string;
  title: string;
  source_lang: string;
  target_lang: string;
  genre: string;
  status: string;
  created_at: string;
}

interface Chunk {
  id: string;
  project_id: string;
  chunk_index: number;
  source_text: string;
  translated_text: string;
  status: string;
  passage_key?: string | null;
  notes?: string | null;
}

export default function TranslationWorkspace() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [newProjectModal, setNewProjectModal] = useState(false);

  // New Project Form
  const [newTitle, setNewTitle] = useState("");
  const [newGenre, setNewGenre] = useState("general");
  const [rawTextImport, setRawTextImport] = useState("");

  // TM Matches
  const [tmMatches, setTmMatches] = useState<TranslationMemoryMatch[]>([]);
  const [tmLoading, setTmLoading] = useState(false);

  // Load User Projects
  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("translation_projects")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setProjects(data || []);
      if (data && data.length > 0 && !selectedProject) {
        selectProject(data[0]);
      }
    } catch (err) {
      console.error(err);
      toast.error("پروژیکٹس لوڈ کرنے میں ناکامی ہوئی۔");
    } finally {
      setLoading(false);
    }
  };

  const selectProject = async (proj: Project) => {
    setSelectedProject(proj);
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("translation_chunks")
        .select("*")
        .eq("project_id", proj.id)
        .order("chunk_index", { ascending: true });

      if (error) throw error;
      const loadedChunks = data || [];
      setChunks(loadedChunks);
      setActiveChunkIndex(0);

      if (loadedChunks.length > 0) {
        fetchTm(loadedChunks[0].source_text, proj.target_lang, proj.genre);
      }
    } catch (err) {
      console.error(err);
      toast.error("پروجیکٹ ڈیٹا لوڈ کرنے میں ناکامی۔");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!newTitle.trim()) {
      toast.error("پروجیکٹ کا عنوان درج کریں۔");
      return;
    }
    setSaving(true);
    try {
      const { data: proj, error: pErr } = await supabase
        .from("translation_projects")
        .insert({
          user_id: session?.user.id,
          title: newTitle.trim(),
          source_lang: "ar",
          target_lang: "ur",
          genre: newGenre,
          status: "in_progress",
        })
        .select()
        .single();

      if (pErr) throw pErr;

      // Split raw text by paragraphs or line breaks into chunks
      const paragraphs = rawTextImport.trim()
        ? rawTextImport.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
        : ["مثالی ابتدائی متن؛ یہاں اپنی کتاب کا عربی متن شامل کریں۔"];

      const chunkRows = paragraphs.map((p, idx) => ({
        project_id: proj.id,
        chunk_index: idx + 1,
        source_text: p,
        translated_text: "",
        status: "draft",
      }));

      const { error: cErr } = await supabase.from("translation_chunks").insert(chunkRows);
      if (cErr) throw cErr;

      toast.success("نیا ٹرانسلیشن پروجیکٹ تیار ہو گیا۔");
      setNewProjectModal(false);
      setNewTitle("");
      setRawTextImport("");
      await loadProjects();
      selectProject(proj);
    } catch (err) {
      console.error(err);
      toast.error("پروجیکٹ کی تخلیق میں ناکامی۔");
    } finally {
      setSaving(false);
    }
  };

  const fetchTm = async (sourceText: string, targetLang: string, genre: string) => {
    setTmLoading(true);
    const matches = await lookupTranslationMemory(sourceText, targetLang, genre);
    setTmMatches(matches);
    setTmLoading(false);
  };

  const handleChunkChange = (index: number) => {
    setActiveChunkIndex(index);
    if (chunks[index]) {
      fetchTm(chunks[index].source_text, selectedProject?.target_lang || "ur", selectedProject?.genre || "general");
    }
  };

  const handleUpdateTranslationText = (text: string) => {
    setChunks((prev) =>
      prev.map((c, idx) => (idx === activeChunkIndex ? { ...c, translated_text: text } : c))
    );
  };

  const handleSaveChunk = async () => {
    const current = chunks[activeChunkIndex];
    if (!current) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("translation_chunks")
        .update({
          translated_text: current.translated_text,
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id);

      if (error) throw error;
      toast.success(`ٹکڑا #${current.chunk_index} محفوظ ہو گیا۔`);
    } catch (err) {
      console.error(err);
      toast.error("محفوظ کرنے میں ناکامی۔");
    } finally {
      setSaving(false);
    }
  };

  const handleAiTranslateChunk = async () => {
    const current = chunks[activeChunkIndex];
    if (!current || !session?.access_token) return;

    setTranslating(true);
    try {
      // The genre guideline must stay OUT of `text` — translate-page translates
      // whatever `text` contains, so prepending the instruction there would get
      // the instruction itself translated into the output. It goes in
      // styleGuidance, which the function passes to the model as guidance only.
      const genrePrompt = GENRE_TRANSLATION_PROMPTS[selectedProject?.genre || "general"]?.prompt || "";
      const body = {
        text: current.source_text,
        genreInstruction: genrePrompt || undefined,
        targetLanguage: selectedProject?.target_lang || "ur",
        sourceLanguage: selectedProject?.source_lang || "ar",
      };

      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/translate-page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "AI ٹرانسلیشن سروس کی ناکامی");
      }

      // translate-page responds with text/event-stream — reading it as JSON
      // would silently yield nothing.
      const translation = await collectSseText(res);
      if (translation.trim()) {
        handleUpdateTranslationText(translation.trim());
        toast.success("AI ترجمہ مکمل ہو گیا۔");
      } else {
        toast.error("ترجمہ موصول نہیں ہوا۔");
      }
    } catch (err) {
      console.error(err);
      toast.error("AI ترجمہ کرنے میں خرابی پیش آئی۔");
    } finally {
      setTranslating(false);
    }
  };

  const applyTmMatch = (match: TranslationMemoryMatch) => {
    handleUpdateTranslationText(match.translated_text);
    toast.success("Translation Memory ترجمہ منتقل کر دیا گیا۔");
  };

  const activeChunk = chunks[activeChunkIndex];

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-3.5rem-4rem)] md:h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Languages className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-base font-semibold">ترجمہ پروجیکٹس (Translation Workspace)</h1>
              <p className="text-xs text-muted-foreground">طویل کتب و مقالہ جات کا Translation Memory کے ساتھ ترجمہ</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setNewProjectModal(true)}>
              <Plus className="h-4 w-4 ml-1.5" />
              نیا پروجیکٹ
            </Button>
          </div>
        </div>

        {/* Workspace Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar: Projects & Chunk List */}
          <div className="w-72 border-r border-border bg-muted/20 flex flex-col overflow-y-auto">
            <div className="p-3 border-b border-border">
              <Label className="text-xs font-semibold mb-1 block">پروژیکٹس فہرست</Label>
              <div className="space-y-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => selectProject(p)}
                    className={`w-full text-right p-2 rounded-md text-xs transition-colors ${
                      selectedProject?.id === p.id
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-accent text-foreground"
                    }`}
                  >
                    <div className="truncate font-semibold">{p.title}</div>
                    <div className="flex items-center gap-1 mt-0.5 opacity-80 text-[10px]">
                      <Badge variant="outline" className="text-[9px] px-1 py-0">{p.genre}</Badge>
                      <span>{p.source_lang.toUpperCase()} ➔ {p.target_lang.toUpperCase()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Chunks Navigation */}
            {selectedProject && (
              <div className="p-3 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold">ابواب / پاراگراف ({chunks.length})</span>
                </div>
                <div className="space-y-1">
                  {chunks.map((c, idx) => (
                    <button
                      key={c.id}
                      onClick={() => handleChunkChange(idx)}
                      className={`w-full text-right p-2 rounded border text-xs flex items-center justify-between transition-colors ${
                        activeChunkIndex === idx
                          ? "border-primary bg-primary/10 font-medium"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <span className="truncate flex-1 pl-2">ٹکڑا #{c.chunk_index}: {c.source_text.slice(0, 20)}...</span>
                      {c.translated_text ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main Editor Panes (Side-by-Side) */}
          {selectedProject && activeChunk ? (
            <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
              {/* Left Pane: Source Text */}
              <div className="flex-1 border-r border-border p-4 flex flex-col overflow-y-auto bg-card">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="secondary" className="text-xs">عربی اصل متن (ٹکڑا #{activeChunk.chunk_index})</Badge>
                  <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(activeChunk.source_text)}>
                    <Copy className="h-3.5 w-3.5 ml-1" /> کاپی
                  </Button>
                </div>
                <div
                  dir="rtl"
                  className="flex-1 p-4 rounded-lg border border-border bg-background text-lg leading-relaxed font-serif select-text overflow-y-auto"
                >
                  {activeChunk.source_text}
                </div>
              </div>

              {/* Center Pane: Target Translation Editor */}
              <div className="flex-1 p-4 flex flex-col overflow-y-auto bg-background">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="text-xs">اردو ترجمہ</Badge>
                    <span className="text-xs text-muted-foreground">مزاج: {GENRE_TRANSLATION_PROMPTS[selectedProject.genre]?.label}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={handleAiTranslateChunk} disabled={translating}>
                      {translating ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" /> : <Sparkles className="h-3.5 w-3.5 ml-1 text-primary" />}
                      AI ترجمہ
                    </Button>
                    <Button size="sm" onClick={handleSaveChunk} disabled={saving}>
                      <Save className="h-3.5 w-3.5 ml-1" />
                      محفوظ کریں
                    </Button>
                  </div>
                </div>

                <Textarea
                  dir="rtl"
                  value={activeChunk.translated_text || ""}
                  onChange={(e) => handleUpdateTranslationText(e.target.value)}
                  placeholder="یہاں اردو ترجمہ تحریر کریں یا AI ترجمہ بٹن دبائیں..."
                  className="flex-1 min-h-[220px] text-base leading-relaxed p-4 font-serif resize-none"
                />

                {/* Bottom Translation Memory (TM) Matches Panel */}
                <div className="mt-4 pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold flex items-center gap-1 text-primary">
                      <BookmarkCheck className="h-4 w-4" />
                      Translation Memory (TM) کی تجاویز ({tmMatches.length})
                    </span>
                    {tmLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                  </div>

                  {tmMatches.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">اس متن کے لیے تاحال سابقہ محفوظ شدہ ترجمہ نہیں ملا۔</p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {tmMatches.map((m, idx) => (
                        <div key={idx} className="p-2 rounded border border-border bg-card text-xs flex items-center justify-between gap-2">
                          <div dir="rtl" className="flex-1">
                            <div className="font-semibold text-foreground">{m.translated_text}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              مطابقت: {(m.match_score * 100).toFixed(0)}% | ذریعہ: {m.source_type}
                            </div>
                          </div>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => applyTmMatch(m)}>
                            استعمال کریں
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-muted-foreground">
              <div>
                <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-40 text-primary" />
                <h3 className="text-base font-semibold mb-1">کوئی پروجیکٹ منتخب نہیں ہوا</h3>
                <p className="text-xs max-w-sm mb-4">نیا پروجیکٹ بنائیں یا سائیڈ بار سے موجودہ ٹرانسلیشن پروجیکٹ کا انتخاب کریں۔</p>
                <Button onClick={() => setNewProjectModal(true)}>نیا پروجیکٹ بنائیں</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* New Project Dialog */}
      <Dialog open={newProjectModal} onOpenChange={setNewProjectModal}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>نیا ٹرانسلیشن پروجیکٹ بنائیں</DialogTitle>
            <DialogDescription>کتاب یا مقالے کا اصل عربی متن شامل کریں تاکہ اسے ابواب میں تقسیم کیا جا سکے۔</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>پروجیکٹ کا عنوان</Label>
              <Input
                placeholder="مثلاً: كتاب التوحيد - ترجمہ و تحقیق"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>علمی صنف / فن کا مزاج</Label>
              <Select value={newGenre} onValueChange={setNewGenre}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(GENRE_TRANSLATION_PROMPTS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v.label} — {v.desc}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>عربی متن (پاراگراف کی صورت میں)</Label>
              <Textarea
                rows={6}
                placeholder="یہاں کتاب کا اصل عربی متن پیسٹ کریں۔ دو بار Enter دبانے سے خودکار ابواب بن جائیں گے..."
                value={rawTextImport}
                onChange={(e) => setRawTextImport(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNewProjectModal(false)}>منسوخ</Button>
            <Button onClick={handleCreateProject} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : "پروجیکٹ بنائیں"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
