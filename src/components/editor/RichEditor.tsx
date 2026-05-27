import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { isRtlText } from "@/utils/textUtils";
import EditorToolbar from "./EditorToolbar";

interface RichEditorProps {
  initialContent?: string;
  placeholder?: string;
  onChange?: (html: string, text: string) => void;
  className?: string;
  editable?: boolean;
}

const RichEditor = ({ initialContent, placeholder, onChange, className, editable = true }: RichEditorProps) => {
  const [isRtl, setIsRtl] = useState(() => isRtlText(initialContent ?? ""));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "Start writing..." }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Underline,
    ],
    content: initialContent ?? "",
    editable,
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none min-h-[400px] focus:outline-none px-6 py-5 leading-relaxed",
        dir: isRtl ? "rtl" : "ltr",
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      const text = e.getText();
      onChange?.(html, text);
    },
  });

  useEffect(() => {
    if (editor && initialContent && !editor.getText().trim()) {
      editor.commands.setContent(initialContent);
      setIsRtl(isRtlText(initialContent));
    }
  }, [initialContent, editor]);

  useEffect(() => {
    if (editor) {
      editor.setOptions({
        editorProps: {
          attributes: {
            class: "prose prose-sm dark:prose-invert max-w-none min-h-[400px] focus:outline-none px-6 py-5 leading-relaxed",
            dir: isRtl ? "rtl" : "ltr",
          },
        },
      });
    }
  }, [isRtl, editor]);

  const toggleDirection = useCallback(() => {
    setIsRtl((prev) => !prev);
  }, []);

  return (
    <div className={cn("rounded-xl border border-border bg-card overflow-hidden shadow-sm", className)}>
      <EditorToolbar editor={editor} isRtl={isRtl} onToggleDirection={toggleDirection} />
      <div className={cn(isRtl && "text-right")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default RichEditor;
export { type RichEditorProps };
