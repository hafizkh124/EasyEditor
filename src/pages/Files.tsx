import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowRight, BookOpen, FilePlus2, MessageSquareText, FileText, Folder, FolderOpen, FolderPlus, Languages, Mic, ScanText, Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import { useFormatDate } from "@/lib/formatDate";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/workspace/EmptyState";
import { useAllDocuments } from "@/core/workspace/useAllDocuments";
import { documentService } from "@/core/workspace/documentService";
import { useSessionHistory } from "@/hooks/useSessionHistory";
import { useBookTranslationList } from "@/hooks/bookTranslations";
import { useAuth } from "@/contexts/AuthContext";
import { availableCapability } from "@/core/capabilities/registry";
import type { Project, ProjectKind } from "@/core/workspace/types";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";

const log = logger.child("Files");

/**
 * Files (SYSTEM-2026 §2, design v3/07-files-me): folders and documents in one
 * tab, and the results of the three jobs (transcripts, OCR text, translations)
 * in another. The mobile "Files" tab and the sidebar's Files entry open it.
 *
 * Translation projects are results, not folders: they open in Book Translation.
 * Sources (Shamela and the rest) join as a third tab with the sources step.
 */

type Tab = "folders" | "results";

const FOLDER_ICON: Partial<Record<ProjectKind, LucideIcon>> = { book: BookOpen };

interface ResultItem {
  id: string;
  title: string;
  updatedAt: string;
  to: string;
  icon: LucideIcon;
  tint: string;
  typeLabel: string;
}

const matches = (text: string, query: string) => text.toLocaleLowerCase().includes(query);


const FilesPage = () => {
  useSeo({ title: "Files — Easy Editor", description: "Your folders, documents and results.", path: "/files", noindex: true });

  const { t, direction } = useLanguage();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get("tab") === "results" ? "results" : "folders";
  const folderId = searchParams.get("folder");
  const [query, setQuery] = useState("");
  const q = query.trim().toLocaleLowerCase();

  const { projects, docsMap, allDocs, loading, error: loadFailed, refresh } = useAllDocuments();
  const transcripts = useSessionHistory("transcribe");
  const ocrSessions = useSessionHistory("ocr");
  const chatHistory = useSessionHistory("research");
  const { user } = useAuth();
  const translateRoute = availableCapability("translate.book")?.route ?? null;
  // The account's, or — on a desktop not signed in — this computer's.
  const bookTranslations = useBookTranslationList(user?.id ?? null, Boolean(translateRoute));

  const folders = projects.filter((p) => p.kind !== "translation");
  const folder = folderId ? folders.find((p) => p.id === folderId) ?? null : null;

  const documents = useMemo(() => {
    const list = folder
      ? (docsMap[folder.id] ?? []).map((d) => ({ ...d, projectName: folder.title }))
      : allDocs.filter((d) => d.projectKind !== "translation");
    return list
      .filter((d) => !q || matches(d.title, q))
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }, [folder, docsMap, allDocs, q]);

  const shownFolders = folders.filter((f) => !q || matches(f.title, q));
  // An open folder also lists the chats started in it.
  const folderChats = folder
    ? chatHistory.items.filter((c) => c.project_id === folder.id && (!q || matches(c.title, q)))
    : [];

  // Each job's results appear only where the job itself exists (registry).
  const results = useMemo<ResultItem[]>(() => {
    const out: ResultItem[] = [];
    const transcribe = availableCapability("transcribe");
    if (transcribe?.route) {
      for (const s of transcripts.items) {
        out.push({ id: `t:${s.id}`, title: s.title, updatedAt: s.updated_at, to: `${transcribe.route}?session=${encodeURIComponent(s.id)}`, icon: Mic, tint: "bg-info-soft text-info", typeLabel: t("filespage.type_transcript", "ٹرانسکرپشن") });
      }
    }
    const ocr = availableCapability("ocr");
    if (ocr?.route) {
      for (const s of ocrSessions.items) {
        out.push({ id: `o:${s.id}`, title: s.title, updatedAt: s.updated_at, to: `${ocr.route}?session=${encodeURIComponent(s.id)}`, icon: ScanText, tint: "bg-warning-soft text-warning", typeLabel: t("filespage.type_ocr", "OCR متن") });
      }
    }
    const translationItem = { icon: Languages, tint: "bg-success-soft text-success", typeLabel: t("filespage.type_translation", "ترجمہ") };
    // Book translations resume in the translator by their own id.
    if (translateRoute) {
      for (const b of bookTranslations.items) {
        out.push({ id: `bt:${b.id}`, title: b.title, updatedAt: b.updatedAt, to: `${translateRoute}/${b.id}`, ...translationItem });
      }
    }
    // A workspace translation project opens in the canvas, on its document.
    for (const p of projects.filter((p) => p.kind === "translation")) {
      const doc = docsMap[p.id]?.[0];
      if (doc) out.push({ id: `tr:${p.id}`, title: p.title, updatedAt: p.updated_at, to: `/workspace/${doc.id}`, ...translationItem });
    }
    return out
      .filter((r) => !q || matches(r.title, q))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [transcripts.items, ocrSessions.items, bookTranslations.items, translateRoute, projects, docsMap, q, t]);
  const resultsLoading = (transcripts.loading || ocrSessions.loading || bookTranslations.loading) && results.length === 0;

  const setParams = (next: { tab?: Tab; folder?: string | null }) => {
    const params = new URLSearchParams(searchParams);
    if (next.tab) {
      if (next.tab === "folders") params.delete("tab");
      else params.set("tab", next.tab);
    }
    if (next.folder !== undefined) {
      if (next.folder) params.set("folder", next.folder);
      else params.delete("folder");
    }
    setSearchParams(params);
  };

  const newDocument = () => navigate("/workspace", { state: { intent: "new-document", projectId: folder?.id } });

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const createFolder = async () => {
    const title = folderName.trim();
    if (!title) return;
    setCreating(true);
    try {
      const created: Project = await documentService.createProject(title, "general");
      setFolderDialogOpen(false);
      setFolderName("");
      await refresh();
      setParams({ tab: "folders", folder: created.id });
    } catch (err) {
      log.error("creating a folder failed", { err });
      toast.error(t("filespage.create_failed"));
    } finally {
      setCreating(false);
    }
  };

  const nothingYet = !loading && !loadFailed && folders.length === 0 && allDocs.length === 0;

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-5 p-4 md:p-8">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 text-2xl font-bold text-foreground">{t("nav.files", "فائلیں")}</h1>
          <Button variant="outline" className="gap-2" onClick={() => setFolderDialogOpen(true)}>
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
            {t("filespage.new_folder", "نیا فولڈر")}
          </Button>
          <Button className="gap-2" onClick={newDocument}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            {t("create.new_document", "نیا دستاویز")}
          </Button>
        </header>

        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("filespage.search", "فائلیں تلاش کریں…")}
            aria-label={t("filespage.search", "فائلیں تلاش کریں…")}
            className="ps-9"
          />
        </div>

        <Tabs value={tab} onValueChange={(v) => setParams({ tab: v as Tab })} dir={direction}>
          <TabsList>
            <TabsTrigger value="folders">{t("filespage.tab_folders", "فولڈر اور دستاویزات")}</TabsTrigger>
            <TabsTrigger value="results">{t("filespage.tab_results", "نتائج")}</TabsTrigger>
          </TabsList>

          <TabsContent value="folders" className="mt-4 space-y-6">
            {loading && allDocs.length === 0 && folders.length === 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              </div>
            ) : loadFailed && folders.length === 0 && allDocs.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title={t("filespage.load_failed_title", "فائلیں لوڈ نہیں ہو سکیں")}
                description={t("filespage.load_failed_desc", "انٹرنیٹ یا سرور میں مسئلہ ہو سکتا ہے۔ دوبارہ کوشش کریں۔")}
                action={<Button onClick={() => void refresh()}>{t("common.retry", "دوبارہ کوشش")}</Button>}
              />
            ) : nothingYet ? (
              <EmptyState
                icon={FolderOpen}
                title={t("filespage.empty_title", "ابھی کوئی فائل نہیں")}
                description={t("filespage.empty_desc", "نیا دستاویز بنائیں، یا + سے آڈیو یا تصویر کا متن نکالیں۔")}
                action={<Button onClick={newDocument}>{t("create.new_document", "نیا دستاویز")}</Button>}
              />
            ) : (
              <>
                {folder ? (
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" className="gap-1" onClick={() => setParams({ folder: null })}>
                      <ArrowRight className="h-4 w-4 ltr:rotate-180" aria-hidden="true" />
                      {t("filespage.back", "تمام فائلیں")}
                    </Button>
                    <h2 className="truncate text-lg font-semibold text-foreground">{folder.title}</h2>
                  </div>
                ) : (
                  shownFolders.length > 0 && (
                    <section aria-labelledby="files-folders" className="space-y-2">
                      <h2 id="files-folders" className="text-sm font-semibold text-muted-foreground">{t("filespage.folders", "فولڈر")}</h2>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {shownFolders.map((f) => {
                          const Icon = FOLDER_ICON[f.kind] ?? Folder;
                          const count = docsMap[f.id]?.length ?? 0;
                          return (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => setParams({ folder: f.id })}
                              className="flex min-h-touch flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-start shadow-xs transition-colors duration-fast hover:border-primary/40 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                              <span className="w-full truncate font-semibold text-foreground">{f.title}</span>
                              <span className="text-xs text-muted-foreground">
                                {t("filespage.doc_count", "{n} دستاویزات").replace("{n}", String(count))}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )
                )}

                {folderChats.length > 0 && (
                  <section aria-labelledby="files-chats" className="space-y-2">
                    <h2 id="files-chats" className="text-sm font-semibold text-muted-foreground">{t("folderindex.chats", "چیٹس")}</h2>
                    <ul aria-labelledby="files-chats" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                      {folderChats.map((c) => (
                        <li key={c.id}>
                          <Link
                            to={`/workspace?panel=research&session=${encodeURIComponent(c.id)}`}
                            className="flex min-h-touch items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          >
                            <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{c.title}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(c.updated_at)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section aria-labelledby="files-documents" className="space-y-2">
                  {!folder && (
                    <h2 id="files-documents" className="text-sm font-semibold text-muted-foreground">
                      {t("filespage.all_documents", "تمام دستاویزات")}
                    </h2>
                  )}
                  {documents.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      {q ? t("filespage.no_match", "تلاش سے کچھ نہیں ملا۔") : t("filespage.folder_empty", "اس فولڈر میں ابھی کوئی دستاویز نہیں۔")}
                    </p>
                  ) : (
                    <ul aria-labelledby={folder ? undefined : "files-documents"} aria-label={folder ? t("folderindex.documents", "دستاویزات") : undefined} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                      {documents.map((d) => (
                        <li key={d.id}>
                          <Link
                            to={`/workspace/${d.id}`}
                            className="flex min-h-touch items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-foreground">{d.title || t("editor.untitled", "بے عنوان")}</span>
                              {!folder && <span className="block truncate text-xs text-muted-foreground">{d.projectName}</span>}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatDate(d.updated_at)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </>
            )}
          </TabsContent>

          <TabsContent value="results" className="mt-4">
            {resultsLoading ? (
              <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
            ) : results.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {q ? t("filespage.no_match", "تلاش سے کچھ نہیں ملا۔") : t("filespage.results_empty", "ٹرانسکرپشن، OCR کا متن اور ترجمے یہاں نظر آئیں گے۔")}
              </p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {results.map((r) => (
                  <li key={r.id}>
                    <Link
                      to={r.to}
                      className="flex min-h-touch items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    >
                      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", r.tint)}>
                        <r.icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{r.title || t("editor.untitled", "بے عنوان")}</span>
                        <span className="block text-xs text-muted-foreground">{r.typeLabel}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatDate(r.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("filespage.new_folder", "نیا فولڈر")}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void createFolder();
            }}
            className="space-y-4"
          >
            <Input
              autoFocus
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder={t("filespage.folder_name", "فولڈر کا نام")}
              aria-label={t("filespage.folder_name", "فولڈر کا نام")}
            />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setFolderDialogOpen(false)}>{t("common.cancel", "منسوخ")}</Button>
              <Button type="submit" disabled={!folderName.trim() || creating}>{t("filespage.create", "بنائیں")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default FilesPage;
