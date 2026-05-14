import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { useCallback, useRef } from "react";
import { ShieldAlert } from "lucide-react";

/**
 * Gates the app for users awaiting admin approval. An unapproved user can SEE
 * the app and navigate around it, but cannot use ANY feature — the only
 * permitted action is signing out.
 *
 * Allowed interactions:
 *  - anything inside <nav>/<aside>/<header> chrome (navigation, notification bell)
 *  - anything inside an element marked [data-approval-allow] (the sign-out button)
 * Everything else (feature buttons, forms, keyboard activation) is blocked.
 */
const ApprovalGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isApproved, loading } = useApproval();
  const { t } = useLanguage();
  const lastToast = useRef(0);

  const isAllowedTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest("nav") ||
        target.closest("aside") ||
        target.closest("header") ||
        target.closest("[data-approval-allow]"),
    );
  }, []);

  const notifyBlocked = useCallback(() => {
    const now = Date.now();
    if (now - lastToast.current > 2000) {
      lastToast.current = now;
      toast.error(t("approval.pending_message"));
    }
  }, [t]);

  const handleBlockedClick = useCallback(
    (e: React.MouseEvent) => {
      if (isAllowedTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      notifyBlocked();
    },
    [isAllowedTarget, notifyBlocked],
  );

  // Keyboard activation of buttons/links — clicks are already caught above, but
  // this also covers role="button" elements and Enter-to-submit cases. Typing
  // inside inputs/textareas is left alone so the UI doesn't feel broken.
  const handleBlockedKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target as Element;
      if (!target.closest?.("button, a, [role='button']")) return;
      if (isAllowedTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      notifyBlocked();
    },
    [isAllowedTarget, notifyBlocked],
  );

  const handleBlockedSubmit = useCallback(
    (e: React.FormEvent) => {
      if (isAllowedTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      notifyBlocked();
    },
    [isAllowedTarget, notifyBlocked],
  );

  if (loading) return null;

  if (isApproved === false) {
    return (
      <div className="relative">
        {/* Banner */}
        <div className="sticky top-0 z-50 bg-destructive/10 border-b border-destructive/20 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center justify-center gap-2 font-medium">
            <ShieldAlert className="h-4 w-4 flex-shrink-0" />
            <span>{t("approval.pending_banner")}</span>
          </div>
          <p className="mt-2 text-center text-xs md:text-sm text-destructive/90 max-w-3xl mx-auto">
            {t("approval.payment_instructions")}
          </p>
          <div className="mt-1 text-center">
            <a
              href="/#payment-accounts"
              className="text-xs md:text-sm font-semibold underline underline-offset-2 hover:opacity-80"
            >
              {t("approval.payment_link")}
            </a>
          </div>
        </div>
        {/* Block feature interactions; navigation + sign-out still pass through. */}
        <div
          onClickCapture={handleBlockedClick}
          onKeyDownCapture={handleBlockedKeyDown}
          onSubmitCapture={handleBlockedSubmit}
        >
          <div className="opacity-60 select-none">{children}</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ApprovalGate;
