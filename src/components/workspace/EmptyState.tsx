import React from "react";
import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Compact vertical rhythm for sub-panels (cards, inline sheets) — default is tab-height. */
  compact?: boolean;
  className?: string;
}

/**
 * SPEC-UIUX F2 — the shared 3-part empty state every tab uses:
 * a calm illustration icon, one line saying what this is, one primary action.
 * Keeps sibling tabs visually identical (F1 discipline).
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className = "",
}) => {
  return (
    <div className={`flex flex-col items-center justify-center ${compact ? "py-4" : "py-16"} text-center px-4 ${className}`}>
      <Icon
        className={`${compact ? "h-6 w-6" : "h-10 w-10"} text-muted-foreground/40 mb-3`}
        strokeWidth={1.5}
      />
      <h3 className={`${compact ? "text-xs" : "text-sm"} font-semibold text-muted-foreground mb-1`}>{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground/70 max-w-[260px] leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
};

export default EmptyState;