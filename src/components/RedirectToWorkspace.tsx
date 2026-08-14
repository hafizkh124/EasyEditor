import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * `/editor` and `/editor/:documentId` outlive the M1 page they used to render
 * (UX-v1 P3) purely so bookmarks keep working. A bare `<Navigate>` declared in
 * the route table cannot see the incoming location, so it would silently drop
 * `location.state` — exactly the handoff content Research/OCR/Transcribe/
 * Extract send through it (see editorHandoff.test.tsx). This reads both the
 * param and the state and carries them across.
 */
export const RedirectToWorkspace: React.FC = () => {
  const { documentId } = useParams<{ documentId?: string }>();
  const { state } = useLocation();
  return <Navigate to={documentId ? `/workspace/${documentId}` : "/workspace"} replace state={state} />;
};

export default RedirectToWorkspace;
