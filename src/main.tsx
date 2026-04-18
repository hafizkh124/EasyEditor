import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { setupPWAUpdates } from "./pwa/registerSW";

createRoot(document.getElementById("root")!).render(<App />);

// Register the service worker for update-notifications only (production + non-iframe).
setupPWAUpdates();
