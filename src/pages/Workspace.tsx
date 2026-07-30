import React, { useEffect, useRef } from "react";
import { useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { documentService } from "@/core/workspace/documentService";
import { htmlToTiptapJSON } from "@/core/workspace/bookSectionMigration";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";

interface WorkspaceHandoffState {
  content?: string;
  source?: "research" | "ocr" | "transcribe" | "manual" | "extract";
}

const WorkspacePage: React.FC = () => {
  const { documentId } = useParams<{ documentId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  const handoff = (location.state as WorkspaceHandoffState) ?? {};
  const handoffContent = handoff.content;
  const handoffSource = handoff.source;

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
        const panelQuery = openWorkbenchFromUrl ? "?panel=research" : "";

        // Content handed over from OCR / Transcribe / Research / Translate /
        // Extract must land in a real document, otherwise the user's text is
        // lost and they see an empty canvas.
        if (handoffContent) {
          const titleKey =
            handoffSource === "research" ? "editor.from_research" :
            handoffSource === "ocr" ? "editor.from_ocr" :
            handoffSource === "transcribe" ? "editor.from_transcribe" :
            handoffSource === "extract" ? "editor.from_extract" :
            "editor.untitled";
          const created = await documentService.createDocument(
            proj.id,
            t(titleKey) || "Untitled Document",
            htmlToTiptapJSON(handoffContent),
          );
          navigate(`/workspace/${created.id}${panelQuery}`, { replace: true });
          return;
        }

        const blank = await documentService.findBlankDocument(proj.id);
        const target = blank ?? (await documentService.createDocument(proj.id, t("editor.untitled") || "Untitled Document"));

        navigate(`/workspace/${target.id}${panelQuery}`, { replace: true });
      } catch (err) {
        console.error("[Workspace] Could not resolve a document:", err);
        autoResolveStarted.current = false;
        toast.error("دستاویز کھولتے ہوئے مسئلہ پیش آیا۔");
      }
    };

    resolveDocument();
  }, [documentId, navigate, openWorkbenchFromUrl, t, handoffContent, handoffSource]);

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
