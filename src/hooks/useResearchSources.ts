import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { useLanguage } from "@/contexts/LanguageContext";
import type { Source } from "@/components/research/types";

const errMsg = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : fallback;

export function useResearchSources(user: User | null) {
  const { t } = useLanguage();
  const userId = user?.id ?? null;
  const [sources, setSources] = useState<Source[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [isAddingUrl, setIsAddingUrl] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadSources = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("research_sources")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (data) setSources(data as Source[]);
  }, [userId]);

  useEffect(() => { loadSources(); }, [loadSources]);

  const processFile = useCallback(async (file: File) => {
    if (!user) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx"].includes(ext || "")) { toast.error(t("research.invalid_file")); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error(t("research.file_too_large")); return; }
    setIsUploading(true);
    try {
      const filePath = `${user.id}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("research-files").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { error: dbError } = await supabase.from("research_sources").insert({
        user_id: user.id, source_type: ext as "pdf" | "docx", title: file.name, storage_path: filePath,
      });
      if (dbError) throw dbError;
      await loadSources();
      toast.success(t("research.source_added"));
    } catch (err: unknown) {
      toast.error(errMsg(err, t("research.upload_error")));
    } finally {
      setIsUploading(false);
    }
  }, [user, loadSources, t]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processFile(file);
  };

  const handleAddUrl = async () => {
    if (!urlInput.trim() || !user) return;
    let url = urlInput.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
    setIsAddingUrl(true);
    try {
      const title = new URL(url).hostname.replace("www.", "");
      const { error } = await supabase.from("research_sources").insert({
        user_id: user.id, source_type: "url", title, url,
      });
      if (error) throw error;
      setUrlInput("");
      await loadSources();
      toast.success(t("research.source_added"));
    } catch (err: unknown) {
      toast.error(errMsg(err, t("research.add_error")));
    } finally {
      setIsAddingUrl(false);
    }
  };

  const handleDeleteSource = async (source: Source) => {
    try {
      if (source.storage_path) await supabase.storage.from("research-files").remove([source.storage_path]);
      await supabase.from("research_sources").delete().eq("id", source.id);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success(t("research.source_removed"));
    } catch {
      toast.error(t("research.delete_error"));
    }
  };

  const handleDeleteAllSources = async () => {
    if (!user || sources.length === 0) return;
    try {
      const filePaths = sources.filter((s) => s.storage_path).map((s) => s.storage_path as string);
      if (filePaths.length > 0) {
        await supabase.storage.from("research-files").remove(filePaths);
      }
      await supabase.from("research_sources").delete().eq("user_id", user.id);
      setSources([]);
      toast.success(t("research.sources_cleared"));
    } catch {
      toast.error(t("research.delete_error"));
    }
  };

  return {
    sources,
    urlInput,
    setUrlInput,
    isAddingUrl,
    isUploading,
    fileInputRef,
    processFile,
    handleFileUpload,
    handleAddUrl,
    handleDeleteSource,
    handleDeleteAllSources,
  };
}
