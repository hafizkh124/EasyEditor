import React, { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
  builtAt?: string;
}

interface AppVersionBadgeProps {
  className?: string;
  compact?: boolean;
  pollIntervalMs?: number;
}

export const AppVersionBadge: React.FC<AppVersionBadgeProps> = ({
  className = "",
  compact = false,
  pollIntervalMs = 5 * 60 * 1000,
}) => {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  const fetchVersion = async () => {
    try {
      const res = await fetch("/app-version.json", { cache: "no-store" });
      if (res.ok) {
        const data: VersionInfo = await res.json();
        setInfo(data);
      }
    } catch {
      // Ignore network errors during polling
    }
  };

  useEffect(() => {
    fetchVersion();
    if (pollIntervalMs > 0) {
      const interval = setInterval(fetchVersion, pollIntervalMs);
      return () => clearInterval(interval);
    }
  }, [pollIntervalMs]);

  if (!info) return null;

  const displayVersion = `v${info.version}${info.commit && info.commit !== "unknown" ? ` (${info.commit})` : ""}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted ${className}`}
            data-testid="app-version-badge"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            {!compact && <span className="font-medium">Easy Editor</span>}
            <span className="font-mono text-xs">{displayVersion}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs space-y-1">
          <p className="font-semibold text-foreground">Easy Editor {info.version}</p>
          <div className="text-muted-foreground font-mono text-xs space-y-0.5">
            <p>Commit: {info.commit}</p>
            <p>Branch: {info.branch}</p>
            {info.builtAt && <p>Built: {new Date(info.builtAt).toLocaleString()}</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export default AppVersionBadge;
