import { useState } from "react";
import { TafsirConnectPanel } from "@/components/tafsir/TafsirConnectPanel";
import { TafsirSearchDialog } from "@/components/tafsir/TafsirSearchDialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { Globe, HardDrive, AlertTriangle } from "lucide-react";
import type { TafsirMode } from "@/lib/tafsir/tafsirService";

/**
 * Tafsir connector (SPEC-TAFSIR §FR-5.2, §FR-5.4):
 *
 * Renders a transport-mode selector above the connect panel. Remote is the
 * default. The switch is user-driven only — a remote failure merely *suggests*
 * local (principle 3), it never auto-flips the mode.
 */
export function TafsirConnector() {
  const [mode, setMode] = useState<TafsirMode>("remote");
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <>
      <div className="space-y-1">
        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as TafsirMode)}
          className="flex gap-2 pt-1"
          dir="rtl"
        >
          <ModeRadio
            checked={mode === "remote"}
            value="remote"
            icon={<Globe className="h-4 w-4 text-primary" />}
            title="آن لائن (پیش فرض)"
            desc="انٹرنیٹ پر مرکز تفسیر کا ذاتی سرور"
          />
          <ModeRadio
            checked={mode === "local"}
            value="local"
            icon={<HardDrive className="h-4 w-4 text-primary" />}
            title="مقامی"
            desc="آف لائن SQLite ڈیٹا بیس (Python + uv)"
          />
        </RadioGroup>

        {mode === "local" && (
          <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            مقامی موڈ کے لیے Python اور uv درکار ہیں؛ اندراج کا بڑا ڈیٹا بیس تیسرے مرحلے میں ہوگا۔
          </p>
        )}
      </div>

      <TafsirConnectPanel
        mode={mode}
        onOpenSearch={() => setSearchOpen(true)}
        onConnectedChange={() => {}}
      />

      <TafsirSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

function ModeRadio({
  checked, value, icon, title, desc,
}: {
  checked: boolean;
  value: string;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <label className="flex-1">
      <RadioGroupItem value={value} className="sr-only" />
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2",
          "cursor-pointer transition-colors select-none",
          checked
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/60 hover:border-primary/40",
        )}
      >
        {icon}
        <span className="leading-tight">
          <span className="block text-xs font-medium text-foreground">{title}</span>
          <span className="block text-xs text-muted-foreground">{desc}</span>
        </span>
      </div>
    </label>
  );
}