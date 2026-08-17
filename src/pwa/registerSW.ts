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
      if (!registration) return;

      // An hourly check was the only trigger besides a cold page load, so a tab
      // that was already open when a deploy landed could serve the old bundle
      // for up to an hour with no prompt. That is not just a stale UI: the
      // precached chunks keep running while `/app-version.json` (not precached)
      // reports the new build, so the app looks deployed while behaving like
      // the previous version — which has repeatedly made a live deploy look
      // like a failed one.
      //
      // The fix is only about *noticing* sooner. Activation stays manual (see
      // `registerType: "prompt"` in vite.config.ts) so a reload can never
      // interrupt work in progress.
      const MIN_INTERVAL_MS = 30_000;
      const POLL_MS = 60_000;
      let lastCheck = 0;
      let timer: ReturnType<typeof setInterval> | undefined;

      const check = () => {
        // The SW script is small and usually answers 304, but a burst of
        // focus/visibility events should still not turn into a burst of
        // requests.
        const now = Date.now();
        if (now - lastCheck < MIN_INTERVAL_MS) return;
        lastCheck = now;
        registration.update().catch(() => {
          /* offline or transient — the next trigger retries */
        });
      };

      const startPolling = () => {
        if (timer === undefined) timer = setInterval(check, POLL_MS);
      };
      const stopPolling = () => {
        if (timer !== undefined) {
          clearInterval(timer);
          timer = undefined;
        }
      };

      // Only poll while the tab is actually being looked at — a background tab
      // polling forever is pure waste, and it will check the moment it is
      // brought back anyway.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          check();
          startPolling();
        } else {
          stopPolling();
        }
      });
      window.addEventListener("focus", check);

      if (document.visibilityState === "visible") startPolling();
    },
  });
}
