import React from "react";
import { TrustTab } from "./TrustTab";

/**
 * "Trust": the run history and audit trail. It used to share this tab with
 * the AI Task Library (TasksTab) behind an inner switch; skills are managed
 * in one place now — Settings → Skills, reached from "Manage skills" at the
 * end of every `/` menu and `Ctrl+K` (SYSTEM-2026 §7).
 */
export const TrustPanel: React.FC = () => (
  <div className="flex h-full flex-col">
    <TrustTab />
  </div>
);
