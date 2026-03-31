import { useApproval } from "@/hooks/useApproval";
import { useLanguage } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { useCallback, useRef } from "react";
import { ShieldAlert } from "lucide-react";

const ApprovalGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isApproved, loading } = useApproval();
  const { t } = useLanguage();
  const lastToast = useRef(0);

  const handleBlockedClick = useCallback((e: React.MouseEvent) => {
    // Allow navigation links in sidebar/nav to work so user can see pages
    const target = e.target as HTMLElement;
    const isNav = target.closest("nav") || target.closest("aside") || target.closest("header");
    if (isNav) return;

    e.preventDefault();
    e.stopPropagation();

    const now = Date.now();
    if (now - lastToast.current > 2000) {
      lastToast.current = now;
      toast.error(t("approval.pending_message"));
    }
  }, [t]);

  if (loading) return null;

  if (isApproved === false) {
    return (
      <div className="relative">
        {/* Banner */}
        <div className="sticky top-0 z-50 flex items-center justify-center gap-2 bg-destructive/10 border-b border-destructive/20 px-4 py-3 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" />
          <span>{t("approval.pending_banner")}</span>
        </div>
        {/* Block interactions on content */}
        <div onClickCapture={handleBlockedClick} className="pointer-events-auto">
          <div className="opacity-60 pointer-events-auto select-none">
            {children}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ApprovalGate;
