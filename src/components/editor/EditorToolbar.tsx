import { type Editor } from "@tiptap/react";
import { Toggle } from "@/components/ui/toggle";
import { Separator } from "@/components/ui/separator";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Undo2, Redo2, AlignLeft, AlignCenter, AlignRight,
  Pilcrow,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EditorToolbarProps {
  editor: Editor | null;
  isRtl: boolean;
  onToggleDirection: () => void;
}

const EditorToolbar = ({ editor, isRtl, onToggleDirection }: EditorToolbarProps) => {
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
    <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/30 flex-wrap">
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
