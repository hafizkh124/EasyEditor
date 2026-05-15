import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setupPWAUpdates } from "./pwa/registerSW";

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
