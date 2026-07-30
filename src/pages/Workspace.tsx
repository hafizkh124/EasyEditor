import React, { useEffect, useRef } from "react";
import { useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { documentService } from "@/core/workspace/documentService";
import { htmlToTiptapJSON } from "@/core/workspace/bookSectionMigration";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Handed over by Research / OCR / Transcribe / Extract / Translate when the
 * user sends a finished result to the editor.
 */
interface WorkspaceLocationState {
  content?: string;
  source?: "research" | "ocr" | "transcribe" | "extract" | "manual";
}

const WorkspacePage: React.FC = () => {
  const { documentId } = useParams<{ documentId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  const state = (location.state as WorkspaceLocationState) ?? {};
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

    const titleForSource = () => {
      switch (state.source) {
        case "research": return t("editor.from_research");
        case "ocr": return t("editor.from_ocr");
        case "transcribe": return t("editor.from_transcribe");
        case "extract": return t("editor.from_extract");
        default: return t("editor.untitled") || "Untitled Document";
      }
    };

    const resolveDocument = async () => {
      try {
        const projects = await documentService.listProjects();
        const proj = projects[0] ?? (await documentService.createProject("General Workspace", "general"));
        const panelQuery = openWorkbenchFromUrl ? "?panel=research" : "";

        // Content handed over from Research/OCR/Transcribe/Extract/Translate
        // has to become a real document here. Falling through to the blank
        // path would silently discard the user's transcript or extraction.
        if (state.content) {
          const created = await documentService.createDocument(
            proj.id,
            titleForSource(),
            htmlToTiptapJSON(state.content),
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
  }, [documentId, navigate, openWorkbenchFromUrl, t, state.content, state.source]);

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
