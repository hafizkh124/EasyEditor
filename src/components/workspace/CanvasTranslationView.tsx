import TranslationWorkspace from "@/pages/TranslationWorkspace";

interface CanvasTranslationViewProps {
  documentId: string;
  projectId: string;
  documentTitle: string;
}

export function CanvasTranslationView({ documentId, projectId, documentTitle }: CanvasTranslationViewProps) {
  return (
    <div className="h-full w-full overflow-hidden bg-background">
      <TranslationWorkspace documentId={documentId} projectId={projectId} documentTitle={documentTitle} />
    </div>
  );
}

export default CanvasTranslationView;
