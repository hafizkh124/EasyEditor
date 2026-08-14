import React, { useEffect, useRef } from "react";
import { useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { isWorkbenchTab } from "@/core/workspace/usePanelState";
import { documentService } from "@/core/workspace/documentService";
import { htmlToTiptapJSON } from "@/core/workspace/bookSectionMigration";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored } from "@/lib/i18n";
import { logger } from "@/lib/logger";

const log = logger.child("Workspace");

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

  // Generalized so /translate and /extract (UX-v1 P3) can redirect here with
  // their own tab preselected, the same way /research already did.
  const panelParam = searchParams.get("panel");
  const workbenchTabFromUrl = isWorkbenchTab(panelParam) ? panelParam : undefined;
  const openWorkbenchFromUrl = workbenchTabFromUrl !== undefined;

  useSeo({
    title: "Workspace — Easy Editor",
    description: "Unified scholarly workspace with Library, Canvas, and Workbench.",
    path: "/workspace",
    noindex: true,
  });

  // SPEC-M6: Only auto-resolve a document if there's handoff content.
  // Otherwise, let the user browse the Home tab and choose a book/document.
  const autoResolveStarted = useRef(false);
  useEffect(() => {
    // If there's handoff content, we need a document to land it in
    if (handoffContent && !autoResolveStarted.current) {
      autoResolveStarted.current = true;

      const resolveDocument = async () => {
        try {
          const projects = await documentService.listProjects();
          const proj = projects[0] ?? (await documentService.createProject("General Workspace", "general"));
          const panelQuery = workbenchTabFromUrl ? `?panel=${workbenchTabFromUrl}` : "";

          const titleKey =
            handoffSource === "research" ? "editor.from_research" :
            handoffSource === "ocr" ? "editor.from_ocr" :
            handoffSource === "transcribe" ? "editor.from_transcribe" :
            handoffSource === "extract" ? "editor.from_extract" :
            "editor.untitled";
          const created = await documentService.createDocument(
            proj.id,
            t(titleKey as import("@/lib/i18n").TranslationKey) || "Untitled Document",
            htmlToTiptapJSON(handoffContent),
          );
          navigate(`/workspace/${created.id}${panelQuery}`, { replace: true });
          return;
        } catch (err) {
          log.error("Could not resolve a document", { err });
          autoResolveStarted.current = false;
          toast.error(translateStored("toast.workspace.open_failed"));
        }
      };

      resolveDocument();
    }
  }, [documentId, navigate, workbenchTabFromUrl, t, handoffContent, handoffSource]);

  return (
    <WorkspaceProvider
      documentId={documentId}
      initialWorkbenchOpenFromUrl={openWorkbenchFromUrl}
      initialWorkbenchTab={workbenchTabFromUrl}
    >
      <WorkspaceLayout />
    </WorkspaceProvider>
  );
};

export default WorkspacePage;
