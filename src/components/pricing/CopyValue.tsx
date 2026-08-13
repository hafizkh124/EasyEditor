import { Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * Account details are copied far more often than they are read — nobody types
 * a 24-character IBAN by hand. These two are the copyable primitives the
 * pricing dialog is built from.
 */

/** Local to this module — both controls below are the only callers. */
const copyToClipboard = async (value: string, copiedLabel: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(copiedLabel);
  } catch {
    toast.error("Copy failed");
  }
};

const copyButtonClass =
  "flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

interface CopyValueProps {
  value: string;
  mono?: boolean;
  small?: boolean;
  label: string;
  copyLabel: string;
  copiedLabel: string;
}

export const CopyValue = ({ value, mono, small, label, copyLabel, copiedLabel }: CopyValueProps) => (
  // `dir="ltr"` regardless of page direction: an IBAN or till id is a Latin
  // string and reverses into nonsense under RTL.
  <div className="flex items-center gap-2 min-w-0" dir="ltr">
    <span className={`font-medium break-all ${mono ? "font-mono" : ""} ${small ? "text-xs" : ""}`}>
      {value}
    </span>
    <button
      type="button"
      onClick={() => copyToClipboard(value, copiedLabel)}
      aria-label={`${copyLabel} ${label}`}
      className={copyButtonClass}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
  </div>
);

interface PhoneValueProps {
  display: string;
  raw: string;
  wa?: string;
  copyLabel: string;
  copiedLabel: string;
  waLabel?: string;
}

export const PhoneValue = ({ display, raw, wa, copyLabel, copiedLabel, waLabel }: PhoneValueProps) => (
  <div className="flex items-center gap-2 min-w-0 flex-wrap" dir="ltr">
    <a href={`tel:${raw}`} className="font-mono font-medium text-primary underline-offset-2 hover:underline">
      {display}
    </a>
    <button
      type="button"
      onClick={() => copyToClipboard(raw, copiedLabel)}
      aria-label={`${copyLabel} ${display}`}
      className={copyButtonClass}
    >
      <Copy className="h-3.5 w-3.5" />
    </button>
    {wa && (
      <a
        href={`https://wa.me/${wa}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={waLabel ?? "WhatsApp"}
        className="flex-shrink-0 rounded-md p-1.5 text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <MessageCircle className="h-3.5 w-3.5" />
      </a>
    )}
  </div>
);
