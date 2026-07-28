import React, { useEffect, useRef } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { documentService } from "@/core/workspace/documentService";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";

const WorkspacePage: React.FC = () => {
  const { documentId } = useParams<{ documentId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const openWorkbenchFromUrl = searchParams.get("panel") === "research";

  useSeo({
    title: "Workspace — Easy Editor",
    description: "Unified scholarly workspace with Library, Canvas, and Workbench.",
    path: "/workspace",
    noindex: true,
  });

  // Auto-resolve blank document if landing on /workspace without a document ID
  const autoResolveStarted = useRef(false);
  useEffect(() => {
    if (documentId || autoResolveStarted.current) return;
    autoResolveStarted.current = true;

    const resolveDocument = async () => {
      try {
        const projects = await documentService.listProjects();
        const proj = projects[0] ?? (await documentService.createProject("General Workspace", "general"));
        const blank = await documentService.findBlankDocument(proj.id);
        const target = blank ?? (await documentService.createDocument(proj.id, t("editor.untitled") || "Untitled Document"));
        
        const panelQuery = openWorkbenchFromUrl ? "?panel=research" : "";
        navigate(`/workspace/${target.id}${panelQuery}`, { replace: true });
      } catch (err) {
        console.error("[Workspace] Could not resolve a document:", err);
        autoResolveStarted.current = false;
        toast.error("دستاویز کھولتے ہوئے مسئلہ پیش آیا۔");
      }
    };

    resolveDocument();
  }, [documentId, navigate, openWorkbenchFromUrl, t]);

  return (
    <WorkspaceProvider
      documentId={documentId}
      initialWorkbenchOpenFromUrl={openWorkbenchFromUrl}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
};

export default WorkspacePage;
