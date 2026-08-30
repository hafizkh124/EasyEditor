import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { prefetchStoredReaderFont } from "./lib/fonts";
import "./index.css";
import { setupPWAUpdates } from "./pwa/registerSW";
import { applyInitialAppTheme } from "./lib/theme";

prefetchStoredReaderFont();
applyInitialAppTheme();

// Desktop on Windows uses a frameless window with an overlaid caption-button
// region at the top-right (electron/main.ts titleBarOverlay). Mark the root so
// the app's top bars can reserve that strip and not sit under the buttons.
try {
  const w = window as unknown as { electronAPI?: { isDesktop?: boolean } };
  const ua = navigator.userAgent || "";
  if (w.electronAPI?.isDesktop && /Windows NT/.test(ua)) {
    document.documentElement.classList.add("electron-win-titlebar");
  }
} catch { /* ignore */ }

const isOAuthBrokerRoute = window.location.pathname.startsWith("/~oauth");

if (isOAuthBrokerRoute && "serviceWorker" in navigator) {
  Promise.all([
    navigator.serviceWorker.getRegistrations().then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    ),
    "caches" in window
      ? caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      : Promise.resolve([]),
  ]).finally(() => {
    window.location.reload();
  });
} else {
  createRoot(document.getElementById("root")!).render(<App />);

  // Register the service worker for update-notifications only (production + non-iframe).
  setupPWAUpdates();
}
