import { type Editor } from "@tiptap/react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight,
  ChevronDown, Maximize2, Minimize2, GitCompare, Check, X,
  Pilcrow, Type, Paintbrush, Table as TableIcon,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { loadEditorFont, type LazyEditorFontId } from "@/lib/fonts";
import { ToolbarAiGroup } from "./ToolbarAiGroup";

interface EditorToolbarProps {
  editor: Editor | null;
  isRtl: boolean;
  onToggleDirection: () => void;
  t: import("@/lib/i18n").Translator;
  aiBusy: string | null;
  onAddHarakat: () => void;
  onRemoveHarakat: () => void;
  onSpellCheck: () => void;
  onAutoFormat: () => void;
  onParaphrase: () => void;
  onSummarize: () => void;
  onCitations: () => void;
  onOpenResources: () => void;
  onSetFont: (fontFamily: string) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  brushActive: boolean;
  onToggleBrush: () => void;
  trackMode: "edit" | "suggest" | "view";
  onSetTrackMode: (mode: "edit" | "suggest" | "view") => void;
  aiReview: boolean;
  onToggleAiReview: () => void;
  pendingCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

/** Named editor fonts → CSS font-family values. Labels render in their own font for preview. */
const FONT_OPTIONS: { labelKey: string; value: string; className: string; loadId?: LazyEditorFontId }[] = [
  { labelKey: "editor.font_default", value: "", className: "" },
  { labelKey: "editor.font_nastaliq", value: "Noto Nastaliq Urdu", className: "font-nastaliq", loadId: "nastaliq" },
  { labelKey: "editor.font_naskh", value: "Noto Naskh Arabic", className: "font-naskh" },
  { labelKey: "editor.font_amiri", value: "Amiri", className: "font-amiri", loadId: "amiri" },
  { labelKey: "editor.font_quran", value: "Amiri Quran", className: "font-quran", loadId: "quran" },
  { labelKey: "editor.font_vazir", value: "Vazirmatn", className: "font-vazir", loadId: "vazir" },
];

const EditorToolbar = ({
  editor, isRtl, onToggleDirection, t, aiBusy,
  onAddHarakat, onRemoveHarakat, onSpellCheck, onAutoFormat, onParaphrase, onSummarize, onCitations, onOpenResources, onSetFont,
  isFullscreen, onToggleFullscreen, brushActive, onToggleBrush,
  trackMode, onSetTrackMode, aiReview, onToggleAiReview, pendingCount, onAcceptAll, onRejectAll,
}: EditorToolbarProps) => {
  if (!editor) return null;

  const groups = [
    [
      { icon: Bold, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive("bold"), label: "Bold" },
      { icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive("italic"), label: "Italic" },
      { icon: UnderlineIcon, action: () => editor.chain().focus().toggleUnderline().run(), active: editor.isActive("underline"), label: "Underline" },
    ],
    [
      { icon: Heading1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive("heading", { level: 1 }), label: "H1" },
      { icon: Heading2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive("heading", { level: 2 }), label: "H2" },
      { icon: Heading3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive("heading", { level: 3 }), label: "H3" },
    ],
    [
      { icon: List, action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive("bulletList"), label: "Bullet List" },
      { icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive("orderedList"), label: "Ordered List" },
      { icon: Quote, action: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive("blockquote"), label: "Quote" },
    ],
    [
      { icon: AlignLeft, action: () => editor.chain().focus().setTextAlign("left").run(), active: editor.isActive({ textAlign: "left" }), label: "Align Left" },
      { icon: AlignCenter, action: () => editor.chain().focus().setTextAlign("center").run(), active: editor.isActive({ textAlign: "center" }), label: "Center" },
      { icon: AlignRight, action: () => editor.chain().focus().setTextAlign("right").run(), active: editor.isActive({ textAlign: "right" }), label: "Align Right" },
    ],
  ];

  return (
    <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/60 flex-wrap">
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <Separator orientation="vertical" className="h-6 mx-1" />}
          {group.map((btn) => (
            <Toggle
              key={btn.label}
              size="sm"
              pressed={btn.active}
              onPressedChange={() => btn.action()}
              aria-label={btn.label}
              className="h-8 w-8 p-0"
            >
              <btn.icon className="h-4 w-4" />
            </Toggle>
          ))}
        </div>
      ))}

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* RTL/LTR toggle */}
      <Toggle
        size="sm"
        pressed={isRtl}
        onPressedChange={onToggleDirection}
        aria-label="Toggle RTL"
        className="h-8 px-2 gap-1 text-xs"
      >
        <Pilcrow className={cn("h-4 w-4", isRtl && "scale-x-[-1]")} />
        {isRtl ? "RTL" : "LTR"}
      </Toggle>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Font family dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" aria-label={t("editor.font")}>
            <Type className="h-4 w-4" />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("editor.font")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {FONT_OPTIONS.map((f) => (
            <DropdownMenuItem
              key={f.value || "default"}
              onClick={() => {
                if (f.loadId) void loadEditorFont(f.loadId);
                onSetFont(f.value);
              }}
              className={cn("cursor-pointer", f.className)}
            >
              {t(f.labelKey as import("@/lib/i18n").TranslationKey)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Format brush */}
      <Toggle
        size="sm"
        pressed={brushActive}
        onPressedChange={onToggleBrush}
        aria-label={t("editor.format_brush")}
        title={t("editor.format_brush")}
        className="h-8 w-8 p-0"
      >
        <Paintbrush className="h-4 w-4" />
      </Toggle>

      {/* Table menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" aria-label={t("editor.table")}>
            <TableIcon className="h-4 w-4" />
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className="cursor-pointer">
            {t("editor.table_insert")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()} disabled={!editor.can().addRowAfter()} className="cursor-pointer">
            {t("editor.table_add_row")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!editor.can().addColumnAfter()} className="cursor-pointer">
            {t("editor.table_add_col")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()} disabled={!editor.can().deleteRow()} className="cursor-pointer">
            {t("editor.table_del_row")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()} disabled={!editor.can().deleteColumn()} className="cursor-pointer">
            {t("editor.table_del_col")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => editor.chain().focus().toggleHeaderRow().run()} disabled={!editor.can().toggleHeaderRow()} className="cursor-pointer">
            {t("editor.table_header")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => editor.chain().focus().deleteTable().run()} disabled={!editor.can().deleteTable()} className="cursor-pointer text-destructive">
            {t("editor.table_delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6 mx-1" />

      <ToolbarAiGroup
        t={t}
        aiBusy={aiBusy}
        onAddHarakat={onAddHarakat}
        onRemoveHarakat={onRemoveHarakat}
        onSpellCheck={onSpellCheck}
        onAutoFormat={onAutoFormat}
        onParaphrase={onParaphrase}
        onSummarize={onSummarize}
        onCitations={onCitations}
        onOpenResources={onOpenResources}
        aiReview={aiReview}
        onToggleAiReview={onToggleAiReview}
      />

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Track changes: mode + accept/reject */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={trackMode === "edit" ? "ghost" : "secondary"} size="sm" className="h-8 gap-1 px-2 text-xs" aria-label={t("editor.track_changes")} title={t("editor.track_changes")}>
            <GitCompare className="h-4 w-4" />
            <span className="hidden sm:inline">{t(`editor.mode_${trackMode}` as import("@/lib/i18n").TranslationKey)}</span>
            {pendingCount > 0 && <span className="ml-0.5 rounded-full bg-primary px-1.5 text-xs leading-4 text-primary-foreground">{pendingCount}</span>}
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>{t("editor.track_changes")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onSetTrackMode("edit")} className={cn("cursor-pointer", trackMode === "edit" && "font-semibold")}>
            {t("editor.mode_edit")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSetTrackMode("suggest")} className={cn("cursor-pointer", trackMode === "suggest" && "font-semibold")}>
            {t("editor.mode_suggest")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSetTrackMode("view")} className={cn("cursor-pointer", trackMode === "view" && "font-semibold")}>
            {t("editor.mode_view")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Accept all */}
      <Button
        variant="ghost" size="sm" className="h-8 w-8 p-0 text-emerald-600"
        onClick={onAcceptAll} disabled={pendingCount === 0} aria-label={t("editor.accept_all")} title={t("editor.accept_all")}
      >
        <Check className="h-4 w-4" />
      </Button>

      {/* Reject all */}
      <Button
        variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive"
        onClick={onRejectAll} disabled={pendingCount === 0} aria-label={t("editor.reject_all")} title={t("editor.reject_all")}
      >
        <X className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Fullscreen toggle */}
      <Toggle
        size="sm"
        pressed={isFullscreen}
        onPressedChange={onToggleFullscreen}
        aria-label={isFullscreen ? t("editor.exit_fullscreen") : t("editor.fullscreen")}
        title={isFullscreen ? t("editor.exit_fullscreen") : t("editor.fullscreen")}
        className="h-8 w-8 p-0"
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Toggle>

      {/* Undo/Redo */}
      <Toggle
        size="sm"
        pressed={false}
        onPressedChange={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        aria-label="Undo"
        className="h-8 w-8 p-0"
      >
        <Undo2 className="h-4 w-4" />
      </Toggle>
      <Toggle
        size="sm"
        pressed={false}
        onPressedChange={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        aria-label="Redo"
        className="h-8 w-8 p-0"
      >
        <Redo2 className="h-4 w-4" />
      </Toggle>
    </div>
  );
};

export default EditorToolbar;
