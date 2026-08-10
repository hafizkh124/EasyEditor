// PWA service-worker registration with strict guards.
// Purpose: ONLY update-detection — show a toast when a new app version is deployed.
// We never register inside the Lovable editor iframe / preview hosts.

import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import { getStoredLanguage, translate } from "@/lib/i18n";

const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const host = window.location.hostname;
const isPreviewHost =
  host.includes("id-preview--") ||
  host.includes("lovableproject.com") ||
  host === "localhost" ||
  host === "127.0.0.1";

export function setupPWAUpdates() {
  // In preview/iframe contexts: actively unregister any existing SW so stale
  // caches from previous experiments do not interfere with the editor preview.
  if (isPreviewHost || isInIframe) {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((r) => r.unregister());
      });
    }
    return;
  }

  if (!("serviceWorker" in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const language = getStoredLanguage();
      toast(translate(language, "pwa.update_title"), {
        description: translate(language, "pwa.update_description"),
        duration: Infinity,
        action: {
          label: translate(language, "pwa.update_action"),
          onClick: () => {
            updateSW(true); // activates new SW + reloads
          },
        },
      });
    },
    onOfflineReady() {
      // No-op — we don't promise full offline support.
    },
    onRegisteredSW(_swUrl, registration) {
      // Check for updates every hour while the app is open.
      if (registration) {
        setInterval(() => {
          registration.update().catch(() => {
            /* network errors are fine */
          });
        }, 60 * 60 * 1000);
      }
    },
  });
}
