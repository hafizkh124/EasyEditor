import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Tells the scholar the connection is gone, instead of leaving buttons that
 * silently do nothing. Mounted once at the app root; it renders nothing while
 * online, and shows "back online" for a few seconds after the link returns.
 *
 * `navigator.onLine` is only a hint (it can say "online" on a dead network),
 * so this never blocks anything — it informs.
 */
export function OfflineBanner() {
  const { t } = useLanguage();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [justBack, setJustBack] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const goOffline = () => {
      if (timer) clearTimeout(timer);
      setJustBack(false);
      setOnline(false);
    };
    const goOnline = () => {
      setOnline(true);
      setJustBack(true);
      timer = setTimeout(() => setJustBack(false), 4000);
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (online && !justBack) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        "pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-3 " +
        "pb-[env(safe-area-inset-bottom)]"
      }
    >
      <div
        className={
          "pointer-events-auto flex items-center gap-2 rounded-full border px-4 py-2 text-xs shadow-lg " +
          (online
            ? "border-success/30 bg-success-soft text-success"
            : "border-warning/40 bg-warning-soft text-foreground")
        }
      >
        {!online && <WifiOff className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />}
        {online ? t("nav.back_online", "Back online") : t("nav.offline", "You are offline. Changes will sync when the connection returns.")}
      </div>
    </div>
  );
}
