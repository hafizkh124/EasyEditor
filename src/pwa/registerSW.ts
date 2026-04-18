// PWA service-worker registration with strict guards.
// Purpose: ONLY update-detection — show a toast when a new app version is deployed.
// We never register inside the Lovable editor iframe / preview hosts.

import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";

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
      toast("نیا ورژن دستیاب ہے / New version available", {
        description:
          "ایپ کا تازہ ترین ورژن آ گیا ہے۔ اپڈیٹ کے لیے کلک کریں۔ / Click to update to the latest version.",
        duration: Infinity,
        action: {
          label: "اپڈیٹ / Update",
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
