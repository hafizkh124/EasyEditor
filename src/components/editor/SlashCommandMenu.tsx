import React, { useState, useEffect, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import {
  Sparkles, Eraser, CheckCheck, RefreshCw, FileText, BookmarkCheck,
  AlignLeft, GraduationCap, Heart, Scissors, Wand2, Volume2, Settings2, FileInput,
} from "lucide-react";
import { stripHarakat } from "@/utils/arabicUtils";
import { useSkills } from "@/lib/skills/useSkills";
import type { Recipe } from "@/lib/recipes/recipeService";
import { useOpenSkillsSettings } from "@/lib/skills/useOpenSkillsSettings";
import type { SelectionBarActions } from "./useEditorAiActions";

interface SlashCommandMenuProps {
  editor: Editor | null;
  actions: SelectionBarActions;
  onAutoFormat: () => void;
  onNavigateSpeak?: () => void;
  /** A recipe picked from `/`: the editor opens its run dialog. */
  onRunRecipe?: (recipe: Recipe) => void;
  /** `/متن نکالیں`: choose a file whose text goes in at the cursor. */
  onExtract?: () => void;
}

interface CommandItemOption {
  id: string;
  label: string;
  category: string;
  icon: React.FC<{ className?: string }>;
  action: () => void;
}

const TASK_ICONS: Record<string, React.FC<{ className?: string }>> = {
  add_harakat: Sparkles,
  remove_harakat: Eraser,
  spelling_check: CheckCheck,
  paraphrase: RefreshCw,
  summarize: FileText,
  citations: BookmarkCheck,
  normalize_script: AlignLeft,
  formalize: GraduationCap,
  humanize: Heart,
  shorten: Scissors,
  auto_format: Wand2,
};

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  editor,
  actions,
  onAutoFormat,
  onNavigateSpeak,
  onRunRecipe,
  onExtract,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [query, setQuery] = useState("");
  /** Exact document range of the typed `/query`, and where to draw the popup. */
  const [trigger, setTrigger] = useState<
    { from: number; to: number; top: number; left: number } | null
  >(null);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setTrigger(null);
    setSelectedIndex(0);
  }, []);

  const { forPlace } = useSkills();
  const openSkillsSettings = useOpenSkillsSettings();

  // The editor's skills from the one skills list (SYSTEM-2026 §7): built-in
  // tasks and my skills, each run by the editor's generic task runner — so
  // nothing in this menu can be a no-op. "Manage skills" closes the list.
  const options: CommandItemOption[] = React.useMemo(() => {
    const items: CommandItemOption[] = forPlace("editor")
      .filter((skill) => !skill.recipe || onRunRecipe)
      .map((skill) => ({
      id: skill.id,
      label: skill.label,
      category:
        skill.recipe ? "کئی مراحل" :
        skill.taskSlug === "auto_format" ? "فارمیٹنگ" : skill.origin === "mine" ? "میری مہارت" : "مہارت",
      icon: (skill.taskSlug && TASK_ICONS[skill.taskSlug]) || skill.icon || Sparkles,
      action: () => {
        if (skill.recipe) {
          onRunRecipe?.(skill.recipe);
          return;
        }
        if (!skill.taskSlug) return;
        if (skill.taskSlug === "auto_format") onAutoFormat();
        else if (actions.runTask) actions.runTask(skill.taskSlug);
      },
    }));

    if (onExtract) {
      items.push({
        id: "extract",
        label: "متن نکالیں (آڈیو، تصویر، PDF)",
        category: "ٹولز",
        icon: FileInput,
        action: onExtract,
      });
    }

    if (onNavigateSpeak) {
      items.push({
        id: "speak",
        label: "آواز میں سنیں (Text-to-Speech / Speak)",
        category: "ٹولز",
        icon: Volume2,
        action: onNavigateSpeak,
      });
    }

    if (openSkillsSettings) {
      items.push({
        id: "manage-skills",
        label: "مہارتیں سنبھالیں",
        category: "",
        icon: Settings2,
        action: openSkillsSettings,
      });
    }

    return items;
  }, [forPlace, actions, onAutoFormat, onNavigateSpeak, onRunRecipe, onExtract, openSkillsSettings]);

  const filteredOptions = React.useMemo(() => {
    const cleanQuery = stripHarakat(query.trim().toLowerCase());
    if (!cleanQuery) return options;
    return options.filter((opt) =>
      stripHarakat(opt.label.toLowerCase()).includes(cleanQuery) ||
      stripHarakat(opt.id.toLowerCase()).includes(cleanQuery),
    );
  }, [options, query]);

  /**
   * Open on a `/` that starts a word, and remember the exact range it occupies.
   *
   * The `(?:^|\s)` prefix is SPEC-M3 FR-3.2's `allowedPrefixes: [null, " "]`, and
   * `[^\s/]*` is `allowSpaces: false`. Together they keep the menu shut while the
   * user types a URL or a date — in `https://example.com` every `/` is preceded
   * by `:` or `/`, never by whitespace.
   */
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      const { selection } = editor.state;
      const { $from, empty } = selection;
      if (!empty || !$from.parent.isTextblock) {
        close();
        return;
      }

      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
      const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
      if (!match) {
        close();
        return;
      }

      const typed = match[1];
      const from = $from.pos - typed.length - 1;

      // Anchor the popup under the `/` itself, measured against our own
      // container so it travels with the editor inside a resizable panel.
      const container = editor.view.dom.closest(".relative") || editor.view.dom.parentElement;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const caret = editor.view.coordsAtPos(from);

      setTrigger({
        from,
        to: $from.pos,
        top: caret.bottom - rect.top + 6,
        left: Math.min(Math.max(caret.left - rect.left, 8), Math.max(8, rect.width - 8)),
      });
      setQuery(typed);
      setIsOpen(true);
    };

    editor.on("selectionUpdate", handleUpdate);
    editor.on("update", handleUpdate);
    return () => {
      editor.off("selectionUpdate", handleUpdate);
      editor.off("update", handleUpdate);
    };
  }, [editor, close]);

  // A changed query can shorten the list — never leave the cursor past its end.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  /**
   * Run an item: first remove exactly the typed `/query`, then act.
   *
   * The range comes from `trigger`, not from `$from.start()` — the latter is the
   * start of the whole paragraph, so using it deleted everything the user had
   * written before the slash.
   */
  const runOption = useCallback(
    (option: CommandItemOption) => {
      if (editor && trigger) {
        editor.chain().focus().deleteRange({ from: trigger.from, to: trigger.to }).run();
      }
      close();
      option.action();
    },
    [editor, trigger, close],
  );

  // Keyboard navigation. The listener is bound to the editor's own DOM node, not
  // to `window` — a capture-phase window listener swallowed the arrow keys for
  // every other input on the page while the menu was open.
  useEffect(() => {
    if (!isOpen || !editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredOptions.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredOptions.length) % Math.max(1, filteredOptions.length));
      } else if (e.key === "Enter") {
        const selected = filteredOptions[selectedIndex];
        if (selected) {
          e.preventDefault();
          runOption(selected);
        }
      } else if (e.key === "Escape") {
        // Close but leave the typed `/` in the document (FR-3.2).
        e.preventDefault();
        close();
      }
    };

    const dom = editor.view.dom;
    dom.addEventListener("keydown", handleKeyDown, true);
    return () => dom.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, filteredOptions, selectedIndex, editor, runOption, close]);

  if (!isOpen || !trigger || filteredOptions.length === 0) return null;

  return (
    <div
      data-testid="slash-command-menu"
      style={{ position: "absolute", top: `${trigger.top}px`, left: `${trigger.left}px` }}
      className="z-50 min-w-[240px] max-w-sm rounded-lg border border-border bg-popover p-1.5 shadow-xl text-popover-foreground animate-in fade-in zoom-in-95"
      dir="rtl"
      role="listbox"
      aria-label="ایڈیٹر کمانڈ مینو"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-b border-border mb-1">
        کمانڈ منتخب کریں ({filteredOptions.length})
      </div>
      <div className="max-h-60 overflow-y-auto space-y-0.5">
        {filteredOptions.map((opt, idx) => {
          const Icon = opt.icon;
          const isSelected = idx === selectedIndex;
          return (
            <button
              key={opt.id}
              role="option"
              aria-selected={isSelected}
              onClick={() => runOption(opt)}
              className={`w-full text-end px-2.5 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${
                isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-accent text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1">{opt.label}</span>
              <span className="text-xs opacity-75">{opt.category}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
