import React, { useEffect, useRef } from "react";
import { useParams, useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { WorkspaceProvider } from "@/core/workspace/WorkspaceContext";
import { ProjectFolderProvider } from "@/core/projectFolder/ProjectFolderContext";
import { AgentRunProvider } from "@/core/workspace/AgentRunContext";
import { WorkspaceLayout } from "@/components/workspace/WorkspaceLayout";
import { isWorkbenchTab } from "@/core/workspace/usePanelState";
import { documentService } from "@/core/workspace/documentService";
import { htmlToTiptapJSON } from "@/core/workspace/bookSectionMigration";
import { markdownToHtml, deriveTitleFromText, looksLikeHtml, htmlToPlainText } from "@/lib/editor/htmlText";
import { useSeo } from "@/hooks/useSeo";
import { useLanguage } from "@/contexts/LanguageContext";
import { translateStored } from "@/lib/i18n";
import { logger } from "@/lib/logger";

const log = logger.child("Workspace");

interface WorkspaceHandoffState {
  content?: string;
  source?: "research" | "ocr" | "transcribe" | "manual";
  /** "+ New document" from the create menu: open a fresh, empty document. */
  intent?: "new-document";
  /** Which folder the new document goes into (Files → a folder → New document). */
  projectId?: string;
  /** A question asked from Home, pre-filled into the research composer. */
  question?: string;
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
  const wantsNewDocument = handoff.intent === "new-document";
  const handoffProjectId = handoff.projectId;

  // Generalized so /translate (UX-v1 P3) can redirect here with
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
    // If there's handoff content (or the create menu asked for a new
    // document), we need a document to land it in.
    if ((handoffContent || wantsNewDocument) && !autoResolveStarted.current) {
      autoResolveStarted.current = true;

      const resolveDocument = async () => {
        try {
          const projects = await documentService.listProjects();
          const proj =
            projects.find((p) => p.id === handoffProjectId) ??
            projects[0] ??
            (await documentService.createProject("General Workspace", "general"));
          const panelQuery = workbenchTabFromUrl ? `?panel=${workbenchTabFromUrl}` : "";

          const titleKey =
            handoffSource === "research" ? "editor.from_research" :
            handoffSource === "ocr" ? "editor.from_ocr" :
            handoffSource === "transcribe" ? "editor.from_transcribe" :
            "editor.untitled";
          // Handoff arrives in three formats depending on who sent it:
          // Some panels send HTML, the research panel sends markdown, and
          // OCR/Transcribe/Translate send plain text. Only the non-HTML ones
          // need converting — before this, markdown went straight into the HTML
          // parser and its `**bold**` and `## heading` markers survived as
          // literal characters in the document.
          const content = handoffContent ?? "";
          const handoffHtml = looksLikeHtml(content)
            ? content
            : markdownToHtml(content);
          // Name the document after what it actually contains; the generic
          // "From Research" style label is only the fallback, since a workspace
          // full of identically-named documents is unnavigable.
          const derivedTitle = deriveTitleFromText(htmlToPlainText(handoffHtml));
          const created = await documentService.createDocument(
            proj.id,
            derivedTitle || t(titleKey as import("@/lib/i18n").TranslationKey) || "Untitled Document",
            htmlToTiptapJSON(handoffHtml),
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
  }, [documentId, navigate, workbenchTabFromUrl, t, handoffContent, handoffSource, wantsNewDocument, handoffProjectId]);

  return (
    <WorkspaceProvider
      documentId={documentId}
      initialWorkbenchOpenFromUrl={openWorkbenchFromUrl}
      initialWorkbenchTab={workbenchTabFromUrl}
      initialWorkbenchQuery={handoff.question}
    >
      <ProjectFolderProvider>
        <AgentRunProvider>
          <WorkspaceLayout />
        </AgentRunProvider>
      </ProjectFolderProvider>
    </WorkspaceProvider>
  );
};

export default WorkspacePage;
