import { useState } from "react";
import { Check, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/contexts/LanguageContext";
import { submitCitationFeedback, type CitationSnapshot } from "@/lib/citationFeedback";
import { UNVERIFIED_DISCLAIMER_AR, type CitationVerifyStatus } from "~shared/citation/verifyCitation";

interface Props {
  citation: CitationSnapshot;
  sourceId?: string;
  verifyStatus?: CitationVerifyStatus;
  /** Called after an Approve — e.g. to insert the citation where it is not already inserted. */
  onApprove?: () => void;
}

/**
 * Two quiet hooks under an AI citation: ✅ Approve & Insert and ✏️ Edit &
 * Correct. Both feed the golden-dataset log (`citationFeedback.ts`); Edit
 * stores what the scholar corrected the citation to.
 */
export function CitationFeedbackBar({ citation, sourceId, verifyStatus, onApprove }: Props) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState<"approve" | "correct" | null>(null);
  const [reference, setReference] = useState(citation.reference);
  const [grade, setGrade] = useState(citation.grade ?? "");
  const [gradedBy, setGradedBy] = useState(citation.gradedBy ?? "");
  const [busy, setBusy] = useState(false);

  const send = async (action: "approve" | "correct") => {
    setBusy(true);
    try {
      await submitCitationFeedback({
        action,
        sourceId,
        verifyStatus,
        original: citation,
        corrected: action === "correct"
          ? { ...citation, reference: reference.trim(), grade: grade.trim() || undefined, gradedBy: gradedBy.trim() || undefined }
          : undefined,
      });
      setDone(action);
      setEditing(false);
      if (action === "approve") onApprove?.();
    } catch {
      toast.error(t("citations.feedback.failed", "Could not save the feedback"));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="text-xs text-muted-foreground" role="status">
        {done === "approve"
          ? t("citations.feedback.approved", "Approved — thank you")
          : t("citations.feedback.corrected", "Correction saved — thank you")}
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {verifyStatus && verifyStatus !== "verified" && (
        <p className="text-xs text-destructive" role="note">
          {verifyStatus === "partial"
            ? t("citations.verify.partial", "Only partly matched in the source")
            : UNVERIFIED_DISCLAIMER_AR}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm" variant="ghost" className="h-6 px-2 text-xs"
          disabled={busy} onClick={() => void send("approve")}
        >
          <Check className="h-3 w-3 me-1" />
          {t("citations.feedback.approve", "Approve & Insert")}
        </Button>
        <Button
          size="sm" variant="ghost" className="h-6 px-2 text-xs"
          disabled={busy} onClick={() => setEditing((e) => !e)}
        >
          <Pencil className="h-3 w-3 me-1" />
          {t("citations.feedback.edit", "Edit & Correct")}
        </Button>
      </div>
      {editing && (
        <div className="space-y-1">
          <Input
            aria-label={t("citations.feedback.reference", "Reference")}
            value={reference} onChange={(e) => setReference(e.target.value)}
          />
          <Input
            aria-label={t("citations.feedback.grade", "Grade")}
            value={grade} onChange={(e) => setGrade(e.target.value)}
          />
          <Input
            aria-label={t("citations.feedback.graded_by", "Graded by (scholar)")}
            value={gradedBy} onChange={(e) => setGradedBy(e.target.value)}
          />
          <Button size="sm" disabled={busy || !reference.trim()} onClick={() => void send("correct")}>
            {t("citations.feedback.save", "Save correction")}
          </Button>
        </div>
      )}
    </div>
  );
}
