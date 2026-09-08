import React from "react";
import { Send, Loader2, Square, FolderOpen, ScrollText, Mic, Plus, Paperclip, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONNECTORS, isConnectorOn } from "../../../shared/agent/connectors";
import { useAgentRun, type AgentMode } from "@/hooks/useAgentRun";

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

  return (
    <div
      className="flex flex-col h-full relative"
      onDragOver={a.onDragOver}
      onDragLeave={a.onDragLeave}
      onDrop={a.onDrop}
    >
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
          remaining space between the shell above and the input below. */}
      <div className="flex-1 min-h-0">{children}</div>

      {/* Input */}
      <div className="relative border-t border-border p-2 shrink-0">
        <input
          ref={a.fileInputRef}
          type="file"
          multiple
          hidden
          accept=".mp3,.m4a,.wav,.ogg,.flac,.mp4,.mkv,.mov,.webm,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.ttf,.otf,.ttc,.dotx,.dotm,.txt,.md"
          onChange={(e) => { if (e.target.files?.length) void a.importFiles(e.target.files); e.target.value = ""; }}
        />
        {a.hubOpen && (
          <div className="absolute bottom-full start-2 mb-1 w-[min(16rem,80vw)] rounded-md border border-border bg-popover p-1 text-xs shadow-md">
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={() => { a.setHubOpen(false); a.fileInputRef.current?.click(); }}>
              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_add_files", "Add recordings, scans, fonts…")}
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={() => { a.setHubOpen(false); a.pf.openFolder(); }}>
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_change_folder", "Change project folder")}
            </button>
            <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start hover:bg-muted" onClick={() => { a.setHubOpen(false); a.updateInput("/", 1); a.taRef.current?.focus(); }}>
              <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {t("agent.hub_playbooks", "Playbooks  (/)")}
            </button>
            <div className="my-1 border-t border-border" />
            <p className="flex items-center gap-1.5 px-2 pb-1 pt-0.5 text-muted-foreground">
              <Plug className="h-3.5 w-3.5 shrink-0" />
              {t("agent.hub_connectors", "Source connectors")}
            </p>
            {CONNECTORS.map((c) => {
              const on = isConnectorOn(a.connectors, c.id);
              return (
                <label key={c.id} className="flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-muted">
                  <span>{c.label}</span>
                  <input type="checkbox" className="accent-primary" checked={on} onChange={(e) => void a.toggleConnector(c.id, e.target.checked)} />
                </label>
              );
            })}
          </div>
        )}
        {a.picker && a.pickerItems.length > 0 && (
          <div className="absolute bottom-full start-2 end-2 mb-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {a.pickerItems.map((it, i) => (
              <button key={i} className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-xs hover:bg-muted" onClick={it.apply}>
                {it.kind === "command" ? <ScrollText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <span className="text-muted-foreground">@</span>}
                <span className="truncate">{it.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0"
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
              if (e.key === "Enter" && !e.shiftKey && !a.picker) { e.preventDefault(); void a.send(); }
              if (e.key === "Escape") a.setPicker(null);
            }}
            rows={2}
            disabled={a.running}
            placeholder={t("agent.placeholder", "Ask, or describe a task…  @chapter  /playbook")}
            className="flex-1 resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
          />
          {a.voice?.transcribe && (
            <Button
              size="icon"
              variant={a.recording ? "default" : "outline"}
              className="h-9 w-9 shrink-0"
              onClick={() => void a.toggleRecord()}
              disabled={a.running || a.transcribing}
              aria-label={a.recording ? t("agent.voice_stop", "Stop dictation") : t("agent.voice_start", "Dictate")}
              title={a.recording ? t("agent.voice_stop", "Stop dictation") : t("agent.voice_start", "Dictate")}
            >
              {a.transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className={`h-4 w-4 ${a.recording ? "animate-pulse" : ""}`} />}
            </Button>
          )}
          {a.running ? (
            <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={a.cancel} aria-label={t("common.cancel", "Cancel")}>
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => void a.send()} disabled={!a.input.trim()} aria-label={t("agent.send", "Send")}>
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
          {(() => { const off = CONNECTORS.filter((c) => !isConnectorOn(a.connectors, c.id)).length; return off > 0 ? (
            <><span className="opacity-40">·</span><span className="shrink-0 text-amber-600">{t("agent.pill_connectors_off", "{n} source off").replace("{n}", String(off))}</span></>
          ) : null; })()}
          <span className="opacity-40">·</span>
          <span className="truncate">{a.caps ?? t("agent.pill_word_off", "Word off")}</span>
        </div>
      </div>
    </div>
  );
};
