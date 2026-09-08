import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Languages, Plus, BookOpen, Sparkles, Check, Copy, Loader2,
  BookmarkCheck, Save
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { lookupTranslationMemory, GENRE_TRANSLATION_PROMPTS, type TranslationMemoryMatch } from "@/lib/translationMemory";
import { collectSseText } from "@/lib/sse";
import { translateStored, translateStoredFormat } from "@/lib/i18n";
import { logger } from "@/lib/logger";
import { documentService } from "@/core/workspace/documentService";
import { htmlToTiptapJSON, translationChunksToHtml } from "@/core/workspace/bookSectionMigration";

const log = logger.child("TranslationWorkspace");

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
  translated_text?: string | null;
  status: string;
  passage_key?: string | null;
  notes?: string | null;
}

interface TranslationWorkspaceProps {
  /** The workspace document (`documents` row) this translation content is
   *  scoped to. There is exactly one `translation_projects` row per document
   *  (UX-v1 P3.4) — no more independent project switching inside this view. */
  documentId: string;
  /** The workspace `projects` row `documentId` belongs to — stamped onto a
   *  newly-created `translation_projects` shell so it's linked the same way
   *  the legacy migration links one (see `bookSectionMigration.ts`). */
  projectId: string;
  /** Pre-fills the title field when starting translation for the first time,
   *  so the user isn't asked to name the same thing twice. */
  documentTitle: string;
}

/**
 * Always rendered embedded inside the Canvas pillar (CanvasTranslationView),
 * never standalone — the standalone `AppLayout`-wrapped shell was retired in
 * UX-v1 P3, since nothing ever passed `embedded={false}` to reach it.
 *
 * UX-v1 P3.4: scoped to a single `documentId` rather than browsing every
 * `translation_projects` row the user owns. Previously this loaded the
 * user's entire `translation_projects` list independently of whatever
 * document the workspace had open, so a document created via the Library's
 * "New Project" (kind: translation) was invisible here and this view's own
 * "New Project" created an orphaned `translation_projects` row with no link
 * back to any workspace document. Now: look up the one row (if any) whose
 * `document_id` matches, and every chunk save also mirrors the chunks into
 * `documents.content_json` (via `translationChunksToHtml` + `htmlToTiptapJSON`,
 * the same conversion the legacy migration uses) so the document stays
 * consistent with the rest of the workspace — searchable, correct word count —
 * without waiting for that migration to run.
 */
export default function TranslationWorkspace({ documentId, projectId, documentTitle }: TranslationWorkspaceProps) {
  const { session } = useAuth();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [activeChunkIndex, setActiveChunkIndex] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [newProjectModal, setNewProjectModal] = useState(false);

  // New Project Form
  const [newTitle, setNewTitle] = useState(documentTitle);
  const [newGenre, setNewGenre] = useState("general");
  const [rawTextImport, setRawTextImport] = useState("");

  // TM Matches
  const [tmMatches, setTmMatches] = useState<TranslationMemoryMatch[]>([]);
  const [tmLoading, setTmLoading] = useState(false);

  // Look up (at most) one translation_projects row for this document.
  // Re-runs if the user switches documents without unmounting the Canvas.
  useEffect(() => {
    loadForDocument();
    setNewTitle(documentTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const loadForDocument = async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from("translation_projects") as any)
        .select("*")
        .eq("document_id", documentId)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        await loadChunks(data);
      } else {
        setSelectedProject(null);
        setChunks([]);
      }
    } catch (err) {
      log.error("loading translation project for document failed", { err });
      toast.error(translateStored("toast.translation.projects_load_failed"));
    } finally {
      setLoading(false);
    }
  };

  const loadChunks = async (proj: Project) => {
    setSelectedProject(proj);
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
      log.error("opening translation project failed", { err });
      toast.error(translateStored("toast.translation.project_load_failed"));
    }
  };

  // Mirrors chunks into `documents.content_json` (source as blockquote,
  // translation as body text — same shape the legacy migration produces) so
  // the rest of the workspace (search, word count, RichEditor if the user
  // ever leaves the translation view) sees real content rather than an empty
  // document. Best-effort: a failure here shouldn't block the chunk save the
  // user actually asked for.
  const syncDocumentContent = async (updatedChunks: Chunk[]) => {
    try {
      const html = translationChunksToHtml(
        updatedChunks.map((c) => ({ ...c, translated_text: c.translated_text ?? null }))
      );
      await documentService.updateDocument(documentId, { content_json: htmlToTiptapJSON(html) });
    } catch (err) {
      log.error("syncing translation chunks to document failed", { err });
    }
  };

  const handleCreateProject = async () => {
    if (!newTitle.trim()) {
      toast.error(translateStored("toast.translation.title_required"));
      return;
    }
    setSaving(true);
    try {
      const { data: proj, error: pErr } = await (supabase.from("translation_projects") as any)
        .insert({
          user_id: session!.user.id,
          title: newTitle.trim(),
          source_lang: "ar",
          target_lang: "ur",
          genre: newGenre,
          status: "in_progress",
          project_id: projectId,
          document_id: documentId,
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

      const { data: insertedChunks, error: cErr } = await supabase
        .from("translation_chunks")
        .insert(chunkRows)
        .select();
      if (cErr) throw cErr;

      toast.success(translateStored("toast.translation.project_created"));
      setNewProjectModal(false);
      setNewTitle(documentTitle);
      setRawTextImport("");
      setSelectedProject(proj);
      const loadedChunks = insertedChunks || [];
      setChunks(loadedChunks);
      setActiveChunkIndex(0);
      if (loadedChunks.length > 0) {
        fetchTm(loadedChunks[0].source_text, proj.target_lang, proj.genre);
      }
      await syncDocumentContent(loadedChunks);
    } catch (err) {
      log.error("creating translation project failed", { err });
      toast.error(translateStored("toast.book.project_create_failed"));
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
      const updatedChunks = chunks.map((c, idx) => (idx === activeChunkIndex ? { ...c, status: "completed" } : c));
      setChunks(updatedChunks);
      toast.success(translateStoredFormat("toast.translation.chunk_saved", { number: current.chunk_index }));
      await syncDocumentContent(updatedChunks);
    } catch (err) {
      log.error("saving chunk failed", { err });
      toast.error(translateStored("toast.common.save_failed"));
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
        toast.success(translateStored("toast.translation.ai_done"));
      } else {
        toast.error(translateStored("toast.translation.ai_empty"));
      }
    } catch (err) {
      log.error("AI translation failed", { err });
      toast.error(translateStored("toast.translation.ai_failed"));
    } finally {
      setTranslating(false);
    }
  };

  const applyTmMatch = (match: TranslationMemoryMatch) => {
    handleUpdateTranslationText(match.translated_text);
    toast.success(translateStored("toast.translation.memory_applied"));
  };

  const activeChunk = chunks[activeChunkIndex];

  const body = (
    // M10 Phase 3 — this whole page's UI text is hardcoded Urdu (no useLanguage()
    // import, no t() calls), unlike the rest of the app — so unlike everywhere
    // else, its RTL-ness is NOT conditional on the app's selected language.
    // dir="rtl" here at the root (rather than scattered per-element, as the
    // sub-panes below already did for the source/translation text areas) is
    // what makes every ms-/me-/text-start/text-end/border-s/border-e below
    // resolve to the same physical sides this page always rendered.
    <div className="flex flex-col h-full w-full overflow-hidden bg-background" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Languages className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-base font-semibold">{documentTitle || "ترجمہ (Translation)"}</h1>
            <p className="text-xs text-muted-foreground">Translation Memory کے ساتھ ترجمہ</p>
          </div>
        </div>
        {!loading && !selectedProject && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setNewProjectModal(true)}>
              <Plus className="h-4 w-4 ms-1.5" />
              ترجمہ شروع کریں
            </Button>
          </div>
        )}
      </div>

      {/* Workspace Body */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar: Chunk list for this document's translation project. */}
        {selectedProject && (
          <div className="w-full md:w-72 max-h-56 md:max-h-none border-b md:border-b-0 md:border-e border-border bg-muted/60 flex flex-col overflow-y-auto shrink-0">
            <div className="p-3 border-b border-border">
              <Badge variant="outline" className="text-xs px-1 py-0">{selectedProject.genre}</Badge>{" "}
              <span className="text-xs text-muted-foreground">{selectedProject.source_lang.toUpperCase()} ➔ {selectedProject.target_lang.toUpperCase()}</span>
            </div>
            <div className="p-3 flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">ابواب / پاراگراف ({chunks.length})</span>
              </div>
              <div className="space-y-1">
                {chunks.map((c, idx) => (
                  <button
                    key={c.id}
                    onClick={() => handleChunkChange(idx)}
                    className={`w-full text-end p-2 rounded border text-xs flex items-center justify-between transition-colors ${
                      activeChunkIndex === idx
                        ? "border-primary bg-primary/10 font-medium"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    <span className="truncate flex-1 ps-2">ٹکڑا #{c.chunk_index}: {c.source_text.slice(0, 20)}...</span>
                    {c.translated_text ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main Editor Panes (Side-by-Side) */}
        {selectedProject && activeChunk ? (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Left Pane: Source Text */}
            <div className="flex-1 border-e border-border p-4 flex flex-col overflow-y-auto bg-card">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="secondary" className="text-xs">عربی اصل متن (ٹکڑا #{activeChunk.chunk_index})</Badge>
                <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(activeChunk.source_text)}>
                  <Copy className="h-3.5 w-3.5 ms-1" /> کاپی
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
                    {translating ? <Loader2 className="h-3.5 w-3.5 animate-spin ms-1" /> : <Sparkles className="h-3.5 w-3.5 ms-1 text-primary" />}
                    AI ترجمہ
                  </Button>
                  <Button size="sm" onClick={handleSaveChunk} disabled={saving}>
                    <Save className="h-3.5 w-3.5 ms-1" />
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
                          <div className="text-xs text-muted-foreground mt-0.5">
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
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            ) : (
              <div>
                <BookOpen className="h-12 w-12 mx-auto mb-3 opacity-40 text-primary" />
                <h3 className="text-base font-semibold mb-1">اس دستاویز کے لیے ابھی ترجمہ شروع نہیں ہوا</h3>
                <p className="text-xs max-w-sm mb-4">عربی اصل متن شامل کریں تاکہ اسے ابواب میں تقسیم کر کے ترجمہ شروع کیا جا سکے۔</p>
                <Button onClick={() => setNewProjectModal(true)}>ترجمہ شروع کریں</Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Project Dialog */}
      <Dialog open={newProjectModal} onOpenChange={setNewProjectModal}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>اس دستاویز کے لیے ترجمہ شروع کریں</DialogTitle>
            <DialogDescription>کتاب یا مقالے کا اصل عربی متن شامل کریں تاکہ اسے ابواب میں تقسیم کیا جا سکے۔</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>عنوان</Label>
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
              {saving ? <Loader2 className="h-4 w-4 animate-spin ms-1" /> : "شروع کریں"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  return body;
}
