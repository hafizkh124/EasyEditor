import React from "react";
import { Bot, Send, Loader2, Square, FolderOpen, Wrench, ScrollText, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, Undo2, Mic, Plus, Paperclip, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CONNECTORS, isConnectorOn } from "../../../shared/agent/connectors";
import { AgentArtifactPanel } from "./AgentArtifactPanel";
import { useAgentRun, type AgentMode } from "@/hooks/useAgentRun";

/**
 * SPEC-M8 Layer 6 / P8b — the Agent tab. Two modes: "Ask" (read-only) and
 * "Do" (tracked-change edits). Every step shows a live present-tense line
 * (§3 UI shape — a trust requirement, not decoration). `/` opens a playbook
 * picker, `@` a mention picker (chapters + the open document's outline +
 * matching Shamela books). A microphone dictates into the chat box via the
 * existing local Whisper. Desktop + VITE_AGENT_MODE only; needs an open
 * project folder.
 *
 * SPEC M10 §1.2 — a pure render layer. Every stateful line lives in
 * `useAgentRun` now (extracted so a future merged research+agent surface can
 * drive the same engine without embedding this whole component).
 */
export const AgentPanel: React.FC = () => {
  const a = useAgentRun();
  const { t } = a;

  if (!a.projectRoot) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center text-muted-foreground">
        <Bot className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t("agent.needs_folder", "The agent works on a folder of .docx chapters — open one to begin.")}</p>
        <p className="text-xs opacity-80">{t("agent.needs_folder_hint", "This is separate from a Library project. Pick the folder where your chapter files live (it can be inside Google Drive / OneDrive).")}</p>
        <Button size="sm" variant="outline" onClick={a.pf.openFolder} className="gap-1.5">
          <FolderOpen className="h-4 w-4" />
          {t("projectfolder.open", "Open a folder of .docx chapters")}
        </Button>
      </div>
    );
  }

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

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-3">
          {a.pf.chapters.length === 0 && (
            <div className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t("agent.no_chapters", "This folder has no .docx or .rtf files yet — the agent has nothing to read. Add chapter files, or pick a different folder.")}
            </div>
          )}
          {a.progress.length === 0 && !a.result && (
            <p className="text-xs text-muted-foreground">
              {a.mode === "ask"
                ? t("agent.hint_ask", "Ask about a chapter or a source. The agent reads and searches — it changes nothing.")
                : a.mode === "plan"
                  ? t("agent.hint_plan", "Describe a task. The agent lays out its steps and waits for your approval before changing anything.")
                  : t("agent.hint_auto", "Describe a task. Every edit lands as a tracked change you review in Word.")}
            </p>
          )}

          {a.artifacts.length > 0 && <AgentArtifactPanel artifacts={a.artifacts} />}

          {a.planPending && (
            <div className="rounded border border-primary/40 bg-primary/5 p-2 text-xs space-y-2">
              <p className="font-medium">{t("agent.plan_ready", "Review the plan above, then approve it to continue.")}</p>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={() => void a.decidePlan("approved")}>{t("agent.plan_approve", "Approve & run")}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void a.decidePlan("rejected")}>{t("agent.plan_reject", "Cancel")}</Button>
              </div>
            </div>
          )}

          {(() => {
            const stepLines = a.progress.filter((p) => p.label && p.kind !== "thinking");
            // While running, the live lines ARE the trust surface — show them all.
            // Once done, collapse a long run into one "Ran N steps ›" card.
            const collapsed = !a.running && !!a.result && stepLines.length > 3 && !a.progressExpanded;
            if (stepLines.length === 0) return null;
            if (collapsed) {
              const errs = stepLines.filter((p) => p.kind === "error").length;
              return (
                <button
                  className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => a.setProgressExpanded(true)}
                >
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  {t("agent.ran_steps", "Ran {n} steps").replace("{n}", String(stepLines.length))}
                  {errs > 0 && <span className="text-amber-600">· {errs}</span>}
                </button>
              );
            }
            return (
              <div className="space-y-1.5">
                {!a.running && a.result && stepLines.length > 3 && (
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => a.setProgressExpanded(false)}>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    {t("agent.collapse_steps", "Hide steps")}
                  </button>
                )}
                {stepLines.map((p, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    {p.kind === "error"
                      ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
                      : p.kind === "done"
                        ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500 mt-0.5" />
                        : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />}
                    <span className={p.kind === "error" ? "text-amber-700 dark:text-amber-400" : "text-foreground"}>
                      {p.label}{p.detail ? ` — ${p.detail}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}

          {a.result && (
            <div className="rounded-md border border-border bg-card p-2.5 space-y-2 text-sm">
              {a.result.error ? (
                <p className="text-destructive text-xs">{a.result.error}</p>
              ) : a.result.stopReason === "needs-input" && a.result.question ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-primary">{t("agent.needs_input", "The agent needs a clarification:")}</p>
                  <p className="whitespace-pre-wrap">{a.result.question}</p>
                  <p className="text-xs text-muted-foreground">{t("agent.needs_input_hint", "Reply below to continue.")}</p>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{a.result.answer || t("agent.no_answer", "(no answer)")}</p>
              )}
              {a.result.playbook && (
                <p className="text-xs text-muted-foreground">{t("agent.used_playbook", "Playbook: {id}").replace("{id}", a.result.playbook)}</p>
              )}
              {a.result.toolCalls.length > 0 && (
                <div>
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => a.setShowTools((s) => !s)}>
                    <Wrench className="h-3 w-3" />
                    {t("agent.tool_calls", "{n} tool calls").replace("{n}", String(a.result.toolCalls.length))}
                  </button>
                  {a.showTools && (
                    <ul className="mt-1 space-y-1 border-s border-border ps-2">
                      {a.result.toolCalls.map((tc, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-mono">{tc.name}</span>
                          <span className="text-muted-foreground"> {JSON.stringify(tc.args)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {a.result.stopReason === "step-limit" && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("agent.step_limit", "Stopped at the step limit — ask a narrower question.")}</p>
              )}
              {a.pendingOptions.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-1.5">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {t("agent.global_option_consent", "This changes a Word setting for every document — approve it?")}
                  </p>
                  <ul className="space-y-0.5 font-mono">
                    {a.pendingOptions.map((o, i) => (
                      <li key={i}>{o.option}: {o.current} → {o.value}</li>
                    ))}
                  </ul>
                  {a.optionsApplied ? (
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => void a.revertOptions()}>
                      <Undo2 className="h-3.5 w-3.5" />
                      {t("agent.revert_settings", "Revert Word settings")}
                    </Button>
                  ) : (
                    <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void a.applyOptions()}>
                      {t("agent.apply_settings", "Apply {n} change(s)").replace("{n}", String(a.pendingOptions.length))}
                    </Button>
                  )}
                </div>
              )}
              {a.pendingOcr.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-1.5">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {t("agent.ocr_consent", "OCR sends the page images to the EasyEditor cloud OCR service — this is not a local reading. Approve it for this project?")}
                  </p>
                  {a.pendingOcr[0]?.scanPath && <p className="font-mono opacity-80">{a.pendingOcr[0].scanPath}</p>}
                  {a.ocrGranted ? (
                    <p className="text-muted-foreground">{t("agent.ocr_consent_granted", "OCR approved for this project — run the task again.")}</p>
                  ) : (
                    <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void a.grantOcr()}>
                      {t("agent.ocr_consent_approve", "Approve cloud OCR for this project")}
                    </Button>
                  )}
                </div>
              )}
              {a.result.checkpointId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => void a.undoTask()}
                  disabled={a.undone}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {a.undone ? t("agent.undone", "Task reverted") : t("agent.undo_task", "Undo this task")}
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

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
          <div className="absolute bottom-full start-2 mb-1 w-64 rounded-md border border-border bg-popover p-1 text-xs shadow-md">
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
