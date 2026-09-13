import React, { useRef } from "react";
import { Send, Loader2, Square, Mic, Plus, X, Book, User, Layers, CalendarClock, Repeat, AtSign, Pencil, Hourglass, ScrollText, FolderOpen, Hash } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CONNECTORS, isConnectorOn } from "../../../shared/agent/connectors";
import { useAgentRun, type AgentMode, type ScopeTag } from "@/hooks/useAgentRun";
import { useClampToViewport } from "@/lib/ui/clampToViewport";
import { ScopeReviewDialog } from "./ScopeReviewDialog";
import { ComposerHub } from "@/components/composer/ComposerHub";
import { CustomPromptsPicker } from "@/components/composer/CustomPromptsPicker";
import { ScholarlyPromptModal } from "@/components/research/ScholarlyPromptModal";

/** Icon + accent for a scope chip, keyed by kind (colour is never the only signal). */
function chipStyle(tag: ScopeTag): { icon: React.ReactNode; cls: string } {
  if (tag.kind === "/") return { icon: <ScrollText className="h-3 w-3 shrink-0" />, cls: "bg-accent text-accent-foreground" };
  if (tag.kind === "@") return { icon: <AtSign className="h-3 w-3 shrink-0" />, cls: "bg-muted text-muted-foreground" };
  const map = { author: <User className="h-3 w-3 shrink-0" />, category: <Layers className="h-3 w-3 shrink-0" />, century: <CalendarClock className="h-3 w-3 shrink-0" /> } as const;
  return { icon: tag.scopeType && tag.scopeType !== "book" ? map[tag.scopeType] : <Book className="h-3 w-3 shrink-0" />, cls: "bg-primary/10 text-primary" };
}

const SECTION_ICON = { book: Book, author: User, category: Layers, century: CalendarClock } as const;

/**
 * SPEC M10 §1.2 — everything AgentPanel.tsx owned that ISN'T the run timeline
 * (that part moved into ChatDisplay's `agent_run` item): the shell (drag-drop
 * wrapper, Ask/Plan/Auto mode toggle, "no chapters"/mode-hint text) wrapping
 * a `children` slot for the timeline, and the composer itself — the `+` hub
 * (attach files, change folder, playbooks, connectors), the `@`/`/`
 * mention+playbook picker, voice dictation, and Send/Cancel.
 *
 * Pure extraction, no behavior change: AgentPanel.tsx now renders
 * `<AgentComposer agent={a}><ChatDisplay agent={...} .../></AgentComposer>`
 * instead of all of this inline, and the merged research+agent panel reuses
 * the exact same pair. ChatDisplay's own built-in composer is suppressed via
 * its `composer` override prop — this bar replaces it, not sits beside it.
 */
export const AgentComposer: React.FC<{ agent: ReturnType<typeof useAgentRun>; children: React.ReactNode }> = ({ agent: a, children }) => {
  const { t } = a;
  const pickerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const [overflowOpen, setOverflowOpen] = React.useState(false);
  const [promptsOpen, setPromptsOpen] = React.useState(false);
  const [scholarlyPromptsOpen, setScholarlyPromptsOpen] = React.useState(false);
  const promptsRef = useRef<HTMLDivElement>(null);
  const { transform: pickerTransform } = useClampToViewport(pickerRef, [a.picker, a.pickerItems.length]);
  const { transform: hubTransform } = useClampToViewport(hubRef, [a.hubOpen]);
  const { transform: promptsTransform } = useClampToViewport(promptsRef, [promptsOpen]);

  const chips = a.scopeTags;
  const visibleChips = chips.slice(0, 4);
  const hiddenChips = chips.slice(4);

  const applyActivePicker = () => {
    const it = a.pickerItems[a.pickerActiveIndex] ?? a.pickerItems[0];
    it?.apply();
  };

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={a.onDragOver}
      onDragLeave={a.onDragLeave}
      onDrop={a.onDrop}
    >
      <ScopeReviewDialog
        request={a.scopeReview}
        onConfirm={a.confirmScopeReview}
        onClose={() => a.setScopeReview(null)}
      />
      {(a.isDragOver || a.importing) && (
        <div className="absolute inset-0 z-30 m-1 flex items-center justify-center rounded border border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
          {a.importing
            ? t("agent.importing", "Adding files to the project…")
            : t("agent.drop_files", "Drop recordings, scans, fonts, or templates to add them")}
        </div>
      )}
      {/* Mode toggle — Ask (read-only) / Plan (approve first) / Auto (M9 ADR-0026) */}
      <div className="flex items-center gap-1 border-b border-border p-2 shrink-0">
        {(["ask", "plan", "auto"] as AgentMode[]).map((m) => (
          <button
            key={m}
            onClick={() => a.setMode(m)}
            disabled={a.running}
            className={`rounded px-2.5 py-1 text-xs font-medium ${a.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {m === "ask" ? t("agent.mode_ask", "Ask") : m === "plan" ? t("agent.mode_plan", "Plan") : t("agent.mode_auto", "Auto")}
          </button>
        ))}
        <button
          className="ms-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate max-w-[55%] disabled:opacity-60"
          title={`${a.pf.folder?.path ?? ""} — ${t("projectfolder.change", "Change folder")}`}
          onClick={a.pf.openFolder}
          disabled={a.running || a.pf.busy}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{a.pf.folder?.manifest.title}</span>
        </button>
      </div>

      {a.pf.chapters.length === 0 && (
        <div className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-2 m-3 mb-0 text-xs text-amber-700 dark:text-amber-400 shrink-0">
          {t("agent.no_chapters", "This folder has no .docx or .rtf files yet — the agent has nothing to read. Add chapter files, or pick a different folder.")}
        </div>
      )}
      {a.progress.length === 0 && !a.result && (
        <p className="px-3 pt-3 text-xs text-muted-foreground shrink-0">
          {a.mode === "ask"
            ? t("agent.hint_ask", "Ask about a chapter or a source. The agent reads and searches — it changes nothing.")
            : a.mode === "plan"
              ? t("agent.hint_plan", "Describe a task. The agent lays out its steps and waits for your approval before changing anything.")
              : t("agent.hint_auto", "Describe a task. Every edit lands as a tracked change you review in Word.")}
        </p>
      )}

      {/* The timeline (ChatDisplay, showing the agent_run item) fills the
          remaining space between the shell above and the input below.
          `flex flex-col` + `overflow-hidden` are load-bearing, not
          decorative: without them this box has no determinate height for
          ChatDisplay's `h-full`-less root to inherit, so ChatDisplay's own
          `overflow-y-auto` messages area never had a bounded height to
          scroll within — its content (e.g. EmptyState's suggestion list)
          just grew past this box's edge and visually overlapped the
          composer below instead of scrolling. Matches the same wrapper
          shape ResearchPanel.tsx's plain (non-agent) path already uses. */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden">{children}</div>

      {/* Input */}
      <div className="relative border-t border-border p-2 shrink-0" data-workspace-composer>
        <input
          ref={a.fileInputRef}
          type="file"
          multiple
          hidden
          accept=".mp3,.m4a,.wav,.ogg,.flac,.mp4,.mkv,.mov,.webm,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.ttf,.otf,.ttc,.dotx,.dotm,.txt,.md"
          onChange={(e) => { if (e.target.files?.length) void a.importFiles(e.target.files); e.target.value = ""; }}
        />
        {a.hubOpen && (
          // QA finding: the connector list alone can run to a dozen+ rows —
          // useClampToViewport only translates position, it cannot shrink a
          // box taller than the viewport, so a fixed-height cap + its own
          // scroll is required or the bottom of the menu renders off-screen.
          <div ref={hubRef} style={{ transform: hubTransform }} className="absolute bottom-full start-2 mb-1 w-[min(16rem,80vw)] max-h-[min(28rem,70vh)] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover text-xs shadow-md">
            <ComposerHub
              showSources
              showSkills
              showConnectors
              showPrompts
              showScholarlyPrompts
              connectors={a.connectors}
              connectorGlobal={a.connectorGlobal}
              connectorState={a.connectorState}
              onToggleConnector={(id, on) => void a.toggleConnector(id, on)}
              onAddFiles={() => a.fileInputRef.current?.click()}
              onChangeFolder={() => a.pf.openFolder()}
              onOpenPlaybooks={() => { a.updateInput("/", 1); a.taRef.current?.focus(); }}
              onOpenScope={() => { a.updateInput(`${a.input}${a.input && !a.input.endsWith(" ") ? " " : ""}#`, a.input.length + (a.input && !a.input.endsWith(" ") ? 2 : 1)); a.taRef.current?.focus(); }}
              onOpenPrompts={() => setPromptsOpen(true)}
              onOpenScholarlyPrompts={() => setScholarlyPromptsOpen(true)}
              onClose={() => a.setHubOpen(false)}
            />
          </div>
        )}
        {promptsOpen && (
          <div ref={promptsRef} style={{ transform: promptsTransform }} className="absolute bottom-full start-2 mb-1 w-[min(20rem,80vw)] max-h-[min(24rem,70vh)] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover text-xs shadow-md">
            <CustomPromptsPicker
              onInsert={(text) => { a.updateInput(text, text.length); a.taRef.current?.focus(); }}
              onClose={() => setPromptsOpen(false)}
            />
          </div>
        )}
        <ScholarlyPromptModal
          isOpen={scholarlyPromptsOpen}
          onClose={() => setScholarlyPromptsOpen(false)}
          onSelectPrompt={(promptText, prompt) => {
            a.updateInput(promptText, promptText.length);
            if (!prompt.corpusReady) toast.warning(t("research.prompt_corpus_pending"));
            setTimeout(() => a.taRef.current?.focus(), 50);
          }}
        />
        {a.picker && a.pickerItems.length > 0 && (
          <div
            ref={pickerRef}
            style={{ transform: pickerTransform }}
            role="listbox"
            aria-label={t("agent.picker_label", "Suggestions")}
            className="absolute bottom-full start-2 end-2 mb-1 max-h-52 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
          >
            {a.pickerItems.map((it, i) => {
              const prev = a.pickerItems[i - 1];
              const showHeader = it.kind === "library" && it.section && it.section !== prev?.section;
              const SectionIcon = it.section ? SECTION_ICON[it.section as keyof typeof SECTION_ICON] : null;
              return (
                <React.Fragment key={i}>
                  {showHeader && (
                    <p className="flex items-center gap-1.5 border-t border-border/50 bg-muted px-2 pt-1 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground first:border-t-0">
                      {SectionIcon ? <SectionIcon className="h-3 w-3" /> : null}
                      {t(`scope.section_${it.section}` as never, it.section ?? "")}
                    </p>
                  )}
                  <button
                    role="option"
                    aria-selected={i === a.pickerActiveIndex}
                    className={`flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs ${i === a.pickerActiveIndex ? "bg-muted" : "hover:bg-muted"}`}
                    onMouseEnter={() => a.setPickerActiveIndex(i)}
                    onClick={it.apply}
                  >
                    {it.kind === "command" ? <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : it.kind === "library" ? <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : <span className="text-muted-foreground">@</span>}
                    <span className="truncate">{it.label}</span>
                    {it.sublabel ? <span className="ms-auto shrink-0 truncate text-muted-foreground/70">{it.sublabel}</span> : null}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
        {/* Plan §4.4 — removable scope chips. Chips are authoritative; the inline
            token in the textarea is cosmetic. */}
        {chips.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1">
            {visibleChips.map((tag) => {
              const { icon, cls } = chipStyle(tag);
              const isGroup = tag.kind === "#" && tag.scopeType && tag.scopeType !== "book";
              return (
                <span
                  key={tag.id}
                  className={`inline-flex max-w-[14rem] items-center gap-1 rounded ps-1.5 pe-1 py-0.5 text-xs ${cls} ${isGroup ? "cursor-pointer" : ""}`}
                  onClick={isGroup ? () => a.setScopeReview({ scopeType: tag.scopeType as "author" | "category" | "century", ref: tag.ref, label: tag.label.split(" · ")[0], filter: tag.sourceFilter ?? {} }) : undefined}
                  title={isGroup ? t("scope.chip_edit", "Click to edit this set") : tag.label}
                >
                  {icon}
                  <span className="truncate">{tag.label}</span>
                  {tag.execMode && tag.execMode !== "search" ? <Repeat className="h-3 w-3 shrink-0 opacity-70" /> : null}
                  <button
                    className="ms-0.5 shrink-0 rounded p-0.5 hover:bg-background/40"
                    onClick={(e) => { e.stopPropagation(); a.removeScopeTag(tag.id); }}
                    aria-label={t("scope.remove_chip", "Remove {label}").replace("{label}", tag.label)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            {hiddenChips.length > 0 && (
              <span className="relative">
                <button
                  className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                  onClick={() => setOverflowOpen((v) => !v)}
                >
                  +{hiddenChips.length}
                </button>
                {overflowOpen && (
                  <div className="absolute bottom-full end-0 mb-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md">
                    {hiddenChips.map((tag) => (
                      <div key={tag.id} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-muted">
                        {chipStyle(tag).icon}
                        <span className="flex-1 truncate">{tag.label}</span>
                        <button className="shrink-0 rounded p-0.5 hover:bg-background/40" onClick={() => a.removeScopeTag(tag.id)} aria-label={t("scope.remove_chip", "Remove {label}").replace("{label}", tag.label)}>
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </span>
            )}
            <button className="ms-1 text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={a.clearScope}>
              {t("scope.clear", "Clear scope")}
            </button>
          </div>
        )}
        {/* M11 Phase 2 — a message typed while the run is in flight, held until it finishes. */}
        {a.queuedMessage && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs">
            <Hourglass className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1 truncate" title={a.queuedMessage}>{a.queuedMessage}</span>
            <button
              className="shrink-0 rounded p-0.5 hover:bg-background/40"
              onClick={a.editQueued}
              aria-label={t("agent.queue_edit", "Edit the queued message")}
              title={t("agent.queue_edit", "Edit the queued message")}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              className="shrink-0 rounded p-0.5 hover:bg-background/40"
              onClick={a.cancelQueued}
              aria-label={t("agent.queue_cancel", "Cancel the queued message")}
              title={t("agent.queue_cancel", "Cancel the queued message")}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 min-h-touch min-w-touch md:min-h-0 md:min-w-0 shrink-0"
            onClick={() => a.setHubOpen((v) => !v)}
            disabled={a.running}
            aria-label={t("agent.hub_open", "Add files, folders, playbooks, connectors")}
            title={t("agent.hub_open", "Add files, folders, playbooks, connectors")}
          >
            <Plus className={`h-4 w-4 transition-transform ${a.hubOpen ? "rotate-45" : ""}`} />
          </Button>
          <textarea
            ref={a.taRef}
            value={a.input}
            onChange={(e) => a.updateInput(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyDown={(e) => {
              if (a.picker && a.pickerItems.length > 0) {
                if (e.key === "ArrowDown") { e.preventDefault(); a.setPickerActiveIndex((a.pickerActiveIndex + 1) % a.pickerItems.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); a.setPickerActiveIndex((a.pickerActiveIndex - 1 + a.pickerItems.length) % a.pickerItems.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); applyActivePicker(); return; }
              }
              if (e.key === "Enter" && !e.shiftKey && !a.picker) { e.preventDefault(); void a.send(); }
              if (e.key === "Escape") a.setPicker(null);
            }}
            rows={2}
            placeholder={a.running
              ? t("agent.placeholder_running", "Queue your next message…")
              : t("agent.placeholder", "Ask, or describe a task…  @chapter  /playbook")}
            className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          {a.voice?.transcribe && (
            <Button
              size="icon"
              variant={a.recording ? "default" : "outline"}
              className="h-9 w-9 min-h-touch min-w-touch md:min-h-0 md:min-w-0 shrink-0"
              onClick={() => void a.toggleRecord()}
              disabled={a.running || a.transcribing}
              aria-label={a.recording ? t("agent.voice_stop", "Stop dictation") : t("agent.voice_start", "Dictate")}
              title={a.recording ? t("agent.voice_stop", "Stop dictation") : t("agent.voice_start", "Dictate")}
            >
              {a.transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className={`h-4 w-4 ${a.recording ? "animate-pulse" : ""}`} />}
            </Button>
          )}
          {a.running ? (
            <Button size="icon" variant="outline" className="h-9 w-9 min-h-touch min-w-touch md:min-h-0 md:min-w-0 shrink-0" onClick={a.cancel} aria-label={t("common.cancel", "Cancel")}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" className="h-9 w-9 min-h-touch min-w-touch md:min-h-0 md:min-w-0 shrink-0" onClick={() => void a.send()} disabled={!a.input.trim()} aria-label={t("agent.send", "Send")}>
              {a.running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          )}
        </div>
        {/* Context stats pill — where the work is going and what's connected. */}
        <div className="mt-1 flex items-center gap-1 overflow-hidden text-xs text-muted-foreground" title={t("agent.caps_title", "This machine's capabilities")}>
          <FolderOpen className="h-3 w-3 shrink-0 opacity-60" />
          <span className="truncate max-w-[38%]">{a.pf.folder?.manifest.title}</span>
          <span className="opacity-40">·</span>
          <span className="shrink-0">{t("agent.pill_chapters", "{n} ch").replace("{n}", String(a.pf.chapters.length))}</span>
          {(() => { const off = CONNECTORS.filter((c) => !(a.connectorState?.[c.id] ?? isConnectorOn(a.connectors, c.id))).length; return off > 0 ? (
            <><span className="opacity-40">·</span><span className="shrink-0 text-amber-600">{t("agent.pill_connectors_off", "{n} source off").replace("{n}", String(off))}</span></>
          ) : null; })()}
          <span className="opacity-40 shrink-0">·</span>
          {/* QA finding: `truncate` alone does nothing on a flex item — a
              flex child's default min-width is its own content size, which
              blocks the shrink truncate depends on and pushed this row past
              its container instead of ellipsing (e.g. "Word 16.0 · Excel
              16.0 · PowerPoint 16.0" in a narrow workbench panel). */}
          <span className="min-w-0 flex-1 truncate">{a.caps ?? t("agent.pill_word_off", "Word off")}</span>
        </div>
      </div>
    </div>
  );
};
