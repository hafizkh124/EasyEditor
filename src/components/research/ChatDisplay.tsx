import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Send, Loader2, Copy, Sparkles, MessageSquarePlus, RefreshCw, Plus,
  Wrench, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2, Undo2,
  PenLine, MessageSquare, Minimize2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { isRtlText as detectRtl } from "@/utils/textUtils";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import type { ChatMessage } from "./types";
import CitationPanel, { type CitationItem } from "./CitationPanel";
import SpellingResponse from "./SpellingResponse";
import CitationResponse from "./CitationResponse";
import ModeChips from "./ModeChips";
import VirtualMessageList from "./VirtualMessageList";
import EmptyState from "./EmptyState";
import { ScholarlyPromptModal } from "./ScholarlyPromptModal";
import type { ScholarlyPromptDef } from "@/lib/prompts/promptsRegistry";
import { useSubmitGuard } from "@/hooks/useSubmitGuard";
import type { ResearchAssistMode } from "@/lib/prompts";
import SourcePicker from "./SourcePicker";
import { editorRoute } from "@/lib/routes";
import { DocumentBox } from "./chat/DocumentBox";
import { SourcesReadyIndicator, BrandSpinner, UserAvatar, AiAvatar } from "./chat/ChatAtoms";
import { renderCitedAnswer } from "@/lib/research/citedAnswer";
import { AgentArtifactPanel } from "@/components/workspace/AgentArtifactPanel";
import { ArtifactChips } from "@/components/workspace/artifacts/ArtifactChips";
import { useOptionalWorkspace } from "@/core/workspace/WorkspaceContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { ProvenanceChips } from "@/components/workspace/ProvenanceChip";
import { RunStatsBar } from "@/components/workspace/RunStatsBar";
import { connectorsUsed } from "~shared/agent/connectors";
import { citationsFromToolCalls } from "~shared/agent/citationsFromToolCalls";
import { isFailedStep } from "~shared/agent/runStats";
import type { AgentRunView, AgentTurn } from "@/hooks/useAgentRun";

const VIRTUALIZE_THRESHOLD = 50;

/* ── Main ChatDisplay ────────────────────────────────────────────── */

interface ChatDisplayProps {
  messages: ChatMessage[];
  isQuerying: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onSendQuery: () => void;
  isRefining: boolean;
  lastAssistantIdx: number;
  onRefine: (action: string) => void;
  onCopyOutput: () => void;
  onClearChat: () => void;
  onRegenerate: () => void;
  researchLimitReached: boolean;
  /** No account at all — a different reason to show than "out of tokens". */
  isSignedIn?: boolean;
  chatEndRef: React.RefObject<HTMLDivElement>;
  t: import("@/lib/i18n").Translator;
  sourcesReadyInfo?: { count: number; domains: string[] } | null;
  citations?: CitationItem[];
  assistModes?: ResearchAssistMode[];
  onAssistModesChange?: (modes: ResearchAssistMode[]) => void;
  /** Islamic-mode source narrowing; empty means every source. */
  selectedDomains?: string[];
  onSelectedDomainsChange?: (next: string[]) => void;
  /** Corpus Atlas finding #7 — restrict citations to rows with real Arabic matn. */
  requireArabicMatn?: boolean;
  onRequireArabicMatnChange?: (next: boolean) => void;
  onContinue?: () => void;
  /**
   * SPEC M10 §1.2 — present once the merged research+agent panel's agent
   * branch is active (an open project folder + wb.agent capability). Absent
   * (plain research chat, no project folder) means exactly today's
   * behavior: no agent-run item ever enters the timeline.
   */
  agent?: AgentRunView;
  /**
   * Fills the REAL composer with a suggestion's text. Required whenever
   * `agent` is set: `onQueryChange` is an inert placeholder in that mode
   * (see `composer` below), so without this the built-in EmptyState
   * suggestions would silently do nothing when clicked. Plain research mode
   * doesn't need it — `onQueryChange` already works.
   */
  onSuggestionSelect?: (text: string) => void;
  /**
   * SPEC M10 §1.2 — replaces ChatDisplay's own built-in composer (Textarea,
   * Send, SourcePicker, assist-mode chips, the scholarly-prompts modal —
   * all research-only concepts) with AgentComposer when the agent branch is
   * active. `query`/`onQueryChange`/`onSendQuery`/`researchLimitReached`
   * and friends are still required props but go unused in that case; the
   * caller passes inert placeholders (see ResearchPanel's agent branch).
   */
  composer?: React.ReactNode;
}

const ChatDisplay = ({
  messages, isQuerying, query, onQueryChange, onSendQuery, isRefining,
  lastAssistantIdx, onRefine, onCopyOutput, onClearChat, onRegenerate,
  researchLimitReached, isSignedIn = false, chatEndRef: _chatEndRef, t,
  sourcesReadyInfo, citations = [],
  assistModes = [], onAssistModesChange,
  selectedDomains = [], onSelectedDomainsChange,
  requireArabicMatn = false, onRequireArabicMatnChange, onContinue,
  agent,
  onSuggestionSelect,
  composer,
}: ChatDisplayProps) => {
  const navigate = useNavigate();
  // Plan §5.2 — when the workspace shell (and thus the artifact stage) is
  // present, the timeline shows a compact chip; otherwise the full inline card.
  const workspace = useOptionalWorkspace();
  // The stage only mounts on desktop (WorkspaceLayout gates it on !isMobile),
  // so on a phone the chip would point at nothing — fall back to the inline card.
  const isMobileViewport = useIsMobile();
  const stageAvailable = workspace !== null && !isMobileViewport;
  // Presence, not truthiness — `composer={null}` is a valid "render nothing
  // here, AgentComposer already supplies the real one around me" signal,
  // and a falsy check would wrongly fall through to the built-in composer.
  const hasCustomComposer = composer !== undefined;
  const isRtlQuery = detectRtl(query);
  const guard = useSubmitGuard(500);
  const guardedSendQuery = guard(onSendQuery);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [inputFocused, setInputFocused] = useState(false);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, []);

  useEffect(() => { autoResize(); }, [query, autoResize]);

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
    toast.success(t("research.copy_message"));
  };

  const lastMsg = messages[messages.length - 1];
  const responseLooksTruncated = useMemo(() => {
    if (!lastMsg || lastMsg.role !== "user") {
      const assistMsg = lastMsg?.role === "assistant" ? lastMsg : null;
      if (!assistMsg || !assistMsg.content || assistMsg.content.length < 200) return false;
      const trimmed = assistMsg.content.trimEnd();
      return !/[.!?؟۔\n```]$/.test(trimmed);
    }
    return false;
  }, [lastMsg]);

  const showSourcesIndicator = sourcesReadyInfo != null && sourcesReadyInfo.count > 0;
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false);
  // SPEC M10 §1.3 — one `+` hub instead of the five separate composer
  // controls this used to have in a row (SourcePicker, ModeChips, the
  // prompts button, plus the mode switcher already removed in §1.1),
  // mirroring AgentComposer's exact hub pattern so the two composers read
  // as one family.
  const [researchHubOpen, setResearchHubOpen] = useState(false);
  const hasNarrowedSources = selectedDomains.length > 0 || requireArabicMatn;
  const hasActiveAssistModes = assistModes.length > 0;

  type ListItem =
    | { type: "empty" }
    | { type: "citations" }
    | { type: "message"; index: number; msg: ChatMessage }
    | { type: "sources_ready" }
    | { type: "typing" }
    // M11 Phase 1 — one bubble pair per FINISHED agent turn (question +
    // answer). `agent.run()` has no memory of its own, so the renderer keeps
    // the thread; these also feed back to the engine as `history`.
    | { type: "agent_turn"; turn: AgentTurn }
    // The CURRENT (or most-recent) run: the full evolving card — progress,
    // result, artifacts, plan-approval, consent. It becomes an `agent_turn`
    // on the next send.
    | { type: "agent_run" }
    | { type: "spacer" };

  // Only real once something has actually happened — an agent prop with an
  // idle hook (no progress, no result, no artifacts, nothing pending) must
  // not insert an empty card into the middle of the conversation.
  const hasAgentActivity = Boolean(
    agent && (
      agent.artifacts.length > 0
      || agent.planPending
      || agent.progress.some((p) => p.label && p.kind !== "thinking")
      || agent.result
    ),
  );

  const agentTurns = useMemo(() => agent?.turns ?? [], [agent?.turns]);

  const listItems = useMemo(() => {
    const items: ListItem[] = [];
    if (messages.length === 0 && !hasAgentActivity && agentTurns.length === 0) items.push({ type: "empty" });
    if (citations.length > 0) items.push({ type: "citations" });
    messages.forEach((msg, i) => items.push({ type: "message", index: i, msg }));
    agentTurns.forEach((turn) => items.push({ type: "agent_turn", turn }));
    if (hasAgentActivity) items.push({ type: "agent_run" });
    if (showSourcesIndicator && isQuerying) items.push({ type: "sources_ready" });
    if (isQuerying && messages[messages.length - 1]?.role !== "assistant") items.push({ type: "typing" });
    items.push({ type: "spacer" });
    return items;
  }, [messages, citations.length, showSourcesIndicator, isQuerying, hasAgentActivity, agentTurns]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  // M11 Phase 1 — a long agent conversation is now scrollable history; only
  // auto-follow the newest item when the reader is already near the bottom, so
  // scrolling up to re-read an earlier turn is not yanked back down.
  const nearBottomRef = useRef(true);
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    if (nearBottomRef.current) {
      bottomAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isQuerying, listItems.length]);

  const handleSuggestionClick = (text: string) => {
    if (onSuggestionSelect) {
      onSuggestionSelect(text);
      return;
    }
    onQueryChange(text);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  /* ── Render a single list item ──────────────────────────────── */
  const renderItem = (item: ListItem, index: number) => {
    let content: React.ReactNode = null;

    if (item.type === "empty") {
      // M11 — the agent-specific suggestions ("Summarize the project's
      // chapters", "Verify the citations") assume an open project/document;
      // with nothing open yet (Ask now runs that way) they'd point at
      // nothing, so fall back to the plain research suggestions instead.
      content = <EmptyState onSuggestionClick={handleSuggestionClick} t={t} isAgentMode={Boolean(agent?.hasWriteTarget)} />;
    } else if (item.type === "citations") {
      content = <CitationPanel citations={citations} t={t} />;
    } else if (item.type === "message") {
      const msg = item.msg;
      const isLastAssistant = msg.role === "assistant" && item.index === messages.length - 1 - lastAssistantIdx;

      if (msg.role === "user") {
        const isRtl = detectRtl(msg.content);
        content = (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex justify-end gap-2"
          >
            <div className="rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[80%] text-sm bg-primary text-primary-foreground shadow-sm">
              <div dir={isRtl ? "rtl" : "ltr"} className={cn("whitespace-pre-wrap", isRtl && "text-end")}>
                {msg.content}
              </div>
            </div>
            <UserAvatar />
          </motion.div>
        );
      } else if (msg.assist) {
        content = (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex gap-2">
            <AiAvatar />
            <div className="space-y-4 max-w-3xl flex-1 min-w-0">
              {msg.assist.promptKey === "spelling" && (
                <SpellingResponse original="" corrected={msg.assist.corrected} changes={msg.assist.changes} t={t} />
              )}
              {msg.assist.promptKey === "citations" && (
                <CitationResponse text={msg.assist.text} citations={msg.assist.citations} totalSegments={msg.assist.total_segments} rejectedSegments={msg.assist.rejected_segments} uncitedSegments={msg.assist.uncited_segments} t={t} />
              )}
              {msg.assist.promptKey === "combined" && (
                <>
                  <SpellingResponse original="" corrected={msg.assist.corrected} changes={msg.assist.changes} t={t} />
                  <CitationResponse text={msg.assist.text} citations={msg.assist.citations} t={t} />
                </>
              )}
            </div>
          </motion.div>
        );
      } else if (isLastAssistant) {
        // Islamic-mode answers get their References section rebuilt from
        // THIS message's own retrieved sources (see citedAnswer.ts) — never
        // the session-wide `citations` prop, which accumulates every turn's
        // sources and would misnumber a [N] marker once a second query has
        // run. Messages saved before sourceCitations existed fall back to
        // no rebuild (the original content is shown as-is).
        const renderedContent = renderCitedAnswer(msg.content, msg.sourceCitations ?? [], t);
        content = (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex gap-2">
            <AiAvatar />
            <div className="flex-1 min-w-0">
              <DocumentBox
                content={renderedContent}
                isRefining={isRefining}
                onRefine={onRefine}
                onCopy={onCopyOutput}
                onRegenerate={onRegenerate}
                onOpenInEditor={() => navigate(editorRoute(), { state: { content: renderedContent, source: "research" } })}
                t={t}
              />
              {responseLooksTruncated && !isQuerying && onContinue && (
                <div className="mt-3 flex justify-center">
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onContinue}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {t("research.continue_generating")}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        );
      } else {
        // Older assistant answers need the same per-message References rebuild
        // as the newest one, otherwise their inline [N] markers point nowhere.
        const olderContent =
          msg.role === "assistant"
            ? renderCitedAnswer(msg.content, msg.sourceCitations ?? [], t)
            : msg.content;
        const isRtl = detectRtl(olderContent);
        content = (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex gap-2 group"
          >
            <AiAvatar />
            <div className="rounded-2xl rounded-tl-md px-4 py-2.5 max-w-[80%] text-sm bg-muted text-foreground border border-border/50 relative shadow-sm">
              <div dir={isRtl ? "rtl" : "ltr"} className={cn("prose prose-sm dark:prose-invert max-w-none", isRtl && "text-end")}>
                <ReactMarkdown>{olderContent}</ReactMarkdown>
              </div>
              <button
                onClick={() => copyMessage(olderContent)}

                className="absolute top-1.5 end-1.5 flex h-7 w-7 min-h-touch min-w-touch md:min-h-0 md:min-w-0 items-center justify-center rounded-md text-muted-foreground transition-all hover:bg-background hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                aria-label={t("research.copy")}
                title={t("research.copy")}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </motion.div>
        );
      }
    } else if (item.type === "sources_ready") {
      content = (
        <AnimatePresence>
          <SourcesReadyIndicator count={sourcesReadyInfo!.count} domains={sourcesReadyInfo!.domains} t={t} />
        </AnimatePresence>
      );
    } else if (item.type === "agent_turn") {
      // M11 Phase 1 — a finished turn: the question, then a compact answer.
      // The live/most-recent run still renders through the full `agent_run`
      // card below; this is the scrollable history behind it.
      const turn = item.turn;
      const answerText =
        turn.result.error
          ? turn.result.error
          : (turn.result.question?.trim() || turn.result.answer || t("agent.no_answer", "(no answer)"));
      const qRtl = detectRtl(turn.instruction);
      const aRtl = detectRtl(answerText);
      content = (
        <div className="space-y-3">
          <div className="flex justify-end gap-2">
            <div className="rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[80%] text-sm bg-primary text-primary-foreground shadow-sm">
              <div dir={qRtl ? "rtl" : "ltr"} className={cn("whitespace-pre-wrap", qRtl && "text-end")}>
                {turn.instruction}
              </div>
            </div>
            <UserAvatar />
          </div>
          <div className="flex gap-2">
            <AiAvatar />
            <div className="flex-1 min-w-0 rounded-md border border-border bg-card p-2.5 text-sm space-y-2">
              <p
                dir={aRtl ? "rtl" : "ltr"}
                className={cn(
                  "whitespace-pre-wrap",
                  aRtl && "text-end",
                  turn.result.error && "text-destructive text-xs",
                )}
              >
                {answerText}
              </p>
              {!turn.result.error && (
                <ProvenanceChips connectorIds={connectorsUsed(turn.result.toolCalls)} />
              )}
              {turn.result.playbook && (
                <p className="text-xs text-muted-foreground">
                  {t("agent.used_playbook", "Playbook: {id}").replace("{id}", turn.result.playbook)}
                </p>
              )}
              {/* M11 — which sources this turn actually retrieved, as the
                  primary surface (CitationPanel renders nothing when empty). */}
              <CitationPanel citations={citationsFromToolCalls(turn.result.toolCalls)} t={t} />
              {turn.result.toolCalls.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("agent.tool_calls", "{n} tool calls").replace("{n}", String(turn.result.toolCalls.length))}
                </p>
              )}
            </div>
          </div>
        </div>
      );
    } else if (item.type === "agent_run" && agent) {
      // SPEC M10 §1.2 — moved verbatim from AgentPanel.tsx (same order:
      // artifacts, plan-approval, steps, result), just reading `agent.*`
      // instead of a local `a.*` hook return.
      const stepLines = agent.progress.filter((p) => p.label && p.kind !== "thinking");
      const collapsed = !isQuerying && !!agent.result && stepLines.length > 3 && !agent.progressExpanded;
      // M11 Phase 6 — the "real answer" case (not an error, not a mode-upgrade
      // ask, not a clarifying question): the only case Copy/Regenerate/Refine
      // apply to.
      const isFinalAnswer = Boolean(
        agent.result && !agent.result.error && !agent.modeUpgradeRequest
        && !(agent.result.stopReason === "needs-input" && agent.result.question),
      );
      content = (
        <div className="max-w-3xl mx-auto space-y-3">
          <RunStatsBar stats={agent.runStats} running={isQuerying} t={t} />

          {agent.artifacts.length > 0 && (
            stageAvailable
              ? <ArtifactChips
                  artifacts={agent.artifacts}
                  activeId={agent.activeArtifactId}
                  onOpen={(id) => { agent.setActiveArtifactId(id); workspace?.setStageCollapsed(false); }}
                />
              : <AgentArtifactPanel artifacts={agent.artifacts} />
          )}

          {agent.planPending && (
            <div className="rounded border border-primary/40 bg-primary/5 p-2 text-xs space-y-2">
              <p className="font-medium">{t("agent.plan_ready", "Review the plan above, then approve it to continue.")}</p>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs" onClick={() => void agent.decidePlan("approved")}>{t("agent.plan_approve", "Approve & run")}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void agent.decidePlan("rejected")}>{t("agent.plan_reject", "Cancel")}</Button>
              </div>
            </div>
          )}

          {stepLines.length > 0 && (collapsed ? (
            <button
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => agent.setProgressExpanded(true)}
            >
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              {t("agent.ran_steps", "Ran {n} steps").replace("{n}", String(stepLines.length))}
              {stepLines.some(isFailedStep) && <span className="text-amber-600">· {stepLines.filter(isFailedStep).length}</span>}
            </button>
          ) : (
            <div className="space-y-1.5">
              {!isQuerying && agent.result && stepLines.length > 3 && (
                <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => agent.setProgressExpanded(false)}>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  {t("agent.collapse_steps", "Hide steps")}
                </button>
              )}
              {stepLines.map((p, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  {isFailedStep(p)
                    ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500 mt-0.5" />
                    : p.kind === "done"
                      ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500 mt-0.5" />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />}
                  <span className={isFailedStep(p) ? "text-amber-700 dark:text-amber-400" : "text-foreground"}>
                    {p.labelKey ? t(p.labelKey as Parameters<typeof t>[0], p.label) : p.label}{p.detail ? ` — ${p.detail}` : ""}
                  </span>
                </div>
              ))}
            </div>
          ))}

          {agent.result && (
            <div className="rounded-md border border-border bg-card p-2.5 space-y-2 text-sm">
              {agent.result.error ? (
                <p className="text-destructive text-xs">{agent.result.error}</p>
              ) : agent.modeUpgradeRequest ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-primary">
                    {t(
                      agent.modeUpgradeRequest.targetMode === "auto" ? "agent.mode_upgrade_prompt_auto" : "agent.mode_upgrade_prompt_plan",
                      agent.modeUpgradeRequest.targetMode === "auto"
                        ? "This needs Auto mode to make changes:"
                        : "This needs Plan mode to make changes:",
                    )}
                  </p>
                  <p className="whitespace-pre-wrap">{agent.modeUpgradeRequest.reason}</p>
                </div>
              ) : agent.result.stopReason === "needs-input" && agent.result.question ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-primary">{t("agent.needs_input", "The agent needs a clarification:")}</p>
                  <p className="whitespace-pre-wrap">{agent.result.question}</p>
                  <p className="text-xs text-muted-foreground">{t("agent.needs_input_hint", "Reply below to continue.")}</p>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{agent.result.answer || t("agent.no_answer", "(no answer)")}</p>
              )}
              {/* M11 Phase 6 — Copy/Regenerate/Refine, the same three quick
                  refine actions DocumentBox offers the plain-chat answer.
                  A lighter inline row rather than adopting DocumentBox
                  wholesale — its own bordered chrome would double-box inside
                  this card, which already hosts plan-approval/consent/undo. */}
              {isFinalAnswer && (
                <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-1.5">
                  {(["formalize", "humanize", "shorten"] as const).map((action) => (
                    <Button
                      key={action}
                      variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                      disabled={agent.refiningAnswer}
                      onClick={() => void agent.refineLastAnswer(action)}
                    >
                      {action === "formalize" ? <PenLine className="h-3 w-3" /> : action === "humanize" ? <MessageSquare className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
                      {t(`research.${action}` as Parameters<typeof t>[0])}
                    </Button>
                  ))}
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs ms-auto" disabled={agent.refiningAnswer} onClick={agent.regenerateLast}>
                    {agent.refiningAnswer ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    {t("research.regenerate")}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => copyMessage(agent.result?.answer ?? "")}>
                    <Copy className="h-3 w-3" />
                    {t("research.copy")}
                  </Button>
                </div>
              )}
              {!agent.result.error && <ProvenanceChips connectorIds={connectorsUsed(agent.result.toolCalls)} />}
              {agent.result.playbook && (
                <p className="text-xs text-muted-foreground">{t("agent.used_playbook", "Playbook: {id}").replace("{id}", agent.result.playbook)}</p>
              )}
              {/* M11 — the primary, discoverable "which sources" surface;
                  the raw tool-call list below stays as a debug toggle. */}
              <CitationPanel citations={citationsFromToolCalls(agent.result.toolCalls)} t={t} />
              {agent.result.toolCalls.length > 0 && (
                <div>
                  <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => agent.setShowTools((s) => !s)}>
                    <Wrench className="h-3 w-3" />
                    {t("agent.tool_calls", "{n} tool calls").replace("{n}", String(agent.result.toolCalls.length))}
                  </button>
                  {agent.showTools && (
                    <ul className="mt-1 space-y-1 border-s border-border ps-2">
                      {agent.result.toolCalls.map((tc, i) => (
                        <li key={i} className="text-xs">
                          <span className="font-mono">{tc.name}</span>
                          <span className="text-muted-foreground"> {JSON.stringify(tc.args)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {agent.result.stopReason === "step-limit" && (
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("agent.step_limit", "Stopped at the step limit — ask a narrower question.")}</p>
              )}
              {agent.modeUpgradeRequest && (
                <div className="rounded border border-primary/40 bg-primary/5 p-2 text-xs space-y-2">
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 text-xs" onClick={() => agent.approveModeUpgrade()}>
                      {t(
                        agent.modeUpgradeRequest.targetMode === "auto" ? "agent.mode_upgrade_approve_auto" : "agent.mode_upgrade_approve_plan",
                        agent.modeUpgradeRequest.targetMode === "auto" ? "Switch to Auto & retry" : "Switch to Plan & retry",
                      )}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => agent.declineModeUpgrade()}>
                      {t("agent.mode_upgrade_decline", "Not now")}
                    </Button>
                  </div>
                </div>
              )}
              {agent.pendingOptions.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-1.5">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {t("agent.global_option_consent", "This changes a Word setting for every document — approve it?")}
                  </p>
                  <ul className="space-y-0.5 font-mono">
                    {agent.pendingOptions.map((o, i) => (
                      <li key={i}>{o.option}: {o.current} → {o.value}</li>
                    ))}
                  </ul>
                  {agent.optionsApplied ? (
                    <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => void agent.revertOptions()}>
                      <Undo2 className="h-3.5 w-3.5" />
                      {t("agent.revert_settings", "Revert Word settings")}
                    </Button>
                  ) : (
                    <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void agent.applyOptions()}>
                      {t("agent.apply_settings", "Apply {n} change(s)").replace("{n}", String(agent.pendingOptions.length))}
                    </Button>
                  )}
                </div>
              )}
              {agent.pendingOcr.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs space-y-1.5">
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    {t("agent.ocr_consent", "OCR sends the page images to the EasyEditor cloud OCR service — this is not a local reading. Approve it for this project?")}
                  </p>
                  {agent.pendingOcr[0]?.scanPath && <p className="font-mono opacity-80">{agent.pendingOcr[0].scanPath}</p>}
                  {agent.ocrGranted ? (
                    <p className="text-muted-foreground">{t("agent.ocr_consent_granted", "OCR approved for this project — run the task again.")}</p>
                  ) : (
                    <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void agent.grantOcr()}>
                      {t("agent.ocr_consent_approve", "Approve cloud OCR for this project")}
                    </Button>
                  )}
                </div>
              )}
              {agent.result.checkpointId && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => void agent.undoTask()}
                  disabled={agent.undone}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {agent.undone ? t("agent.undone", "Task reverted") : t("agent.undo_task", "Undo this task")}
                </Button>
              )}
            </div>
          )}

          {/* M11 Phase 2 — deterministic "what next?" chips (ADR-0049). */}
          {!isQuerying && agent.recommendations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("agent.rec_title", "💡 اگلے ممکنہ اقدامات")}</p>
              <div className="flex flex-wrap gap-1.5">
                {agent.recommendations.map((rec) => (
                  <button
                    key={rec.id}
                    onClick={() => agent.applyRecommendation(rec)}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t(rec.labelKey as Parameters<typeof t>[0], rec.action)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    } else if (item.type === "typing") {
      content = (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2 items-start"
        >
          <AiAvatar />
          <div className="rounded-2xl rounded-tl-md px-4 py-3 bg-muted border border-border/50 flex items-center gap-2.5 shadow-sm">
            {/* M11 Phase 5 / M12 Phase H — BrandSpinner replaces the plain
                TypingDots it was built to replace but was never wired to. Its
                real win here: it respects prefers-reduced-motion (TypingDots
                never did — a genuine, if small, accessibility gap). The
                `state` mirrors the label below; "loading"/"thinking" render
                identically today, a `done` checkmark state exists for a
                future caller that has one. */}
            <BrandSpinner state={showSourcesIndicator ? "thinking" : "loading"} />
            <span className="text-xs text-muted-foreground">
              {showSourcesIndicator ? t("research.generating_with_sources") : t("research.thinking")}
            </span>
          </div>
        </motion.div>
      );
    } else if (item.type === "spacer") {
      content = <div className="h-4" />;
    }

    return (
      <div key={index} className="pb-4">
        {content}
      </div>
    );
  };

  /* ── Layout ─────────────────────────────────────────────────── */
  return (
    // min-w-0: ResearchPanel's wrapper switches to `lg:flex-row` at ≥1024px
    // viewport width, turning this root into a horizontal flex item. Without
    // this, its default min-width (auto = its content's min-content size,
    // driven up by the `max-w-3xl` input below) let it refuse to shrink to
    // the Workbench panel's actual ~450px share — the input box and its
    // suggestion cards rendered up to 34px past the window edge, worse in
    // RTL than LTR (SPEC-M9 QA finding).
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <h1 className="text-lg font-semibold text-foreground">{t("research.title")}</h1>
        <Button variant="ghost" size="sm" onClick={onClearChat} className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-foreground">
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("common.new_chat")}</span>
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className={cn(
        "flex-1 w-full relative",
        listItems.length > VIRTUALIZE_THRESHOLD ? "overflow-hidden" : "overflow-y-auto",
      )}>
        {listItems.length > VIRTUALIZE_THRESHOLD ? (
          <div className="absolute inset-0 px-4 py-4">
            <div className="max-w-3xl mx-auto h-full">
              <VirtualMessageList
                count={listItems.length}
                renderItem={(i) => renderItem(listItems[i], i)}
                getKey={(i) => {
                  const item = listItems[i];
                  if (item.type === "message") return `m:${item.index}:${item.msg.role}:${item.msg.content.length}`;
                  if (item.type === "agent_turn") return `turn:${item.turn.id}`;
                  return `${item.type}:${i}`;
                }}
              />
              <div ref={bottomAnchorRef} />
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-4">
            {listItems.map((item, index) => renderItem(item, index))}
            <div ref={bottomAnchorRef} />
          </div>
        )}
      </div>

      {/* Input area — overridden entirely by `composer` when the caller
          supplies one (SPEC M10 §1.2: the merged panel's agent branch swaps
          in AgentComposer, which has its own mode-aware Send/mention-picker/
          dictation/hub — none of ChatDisplay's research-only composer
          pieces below, assist chips included, apply to that mode). */}
      {hasCustomComposer ? (
        composer && <div className="shrink-0">{composer}</div>
      ) : (
      <div className="px-4 pb-4 pt-2 space-y-2">
        {/* Why Send is disabled — a guest, or an account out of tokens, saw
            nothing here before; Ctrl+Enter and the button both did nothing
            silently (SPEC-M9 QA finding). */}
        {(!isSignedIn || researchLimitReached) && (
          <p className="max-w-3xl mx-auto mb-1.5 px-1 text-xs text-center text-muted-foreground">
            {!isSignedIn
              ? t("research.sign_in_required", "تحقیقی سوالات بھیجنے کے لیے سائن اِن کریں — اوپر دائیں طرف \"سائن اِن\" بٹن دبائیں۔")
              : t(
                  "research.islamic_limit_reached",
                  "اس عمل کے لیے آپ کے پاس کافی ٹوکنز نہیں ہیں۔ براہ کرم ٹاپ اپ کریں یا پلان اپ گریڈ کریں۔",
                )}
          </p>
        )}

        {/* Modern input container */}
        <div className={cn(
          "max-w-3xl mx-auto rounded-2xl border bg-card shadow-sm transition-all duration-200",
          inputFocused
            ? "border-primary/50 shadow-md ring-2 ring-primary/10"
            : "border-border hover:border-border/80",
        )}>
          <div className="flex gap-2 items-end p-3 relative">
            {/* SPEC M10 §1.3 — one `+` hub instead of a scattered row
                (SourcePicker, ModeChips, the prompts button) below the
                input. Same button position and popover shape as
                AgentComposer's hub, so the two composers read as one
                family rather than two different UIs. */}
            {(onSelectedDomainsChange || onAssistModesChange) && (
              <div className="relative shrink-0">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-9 w-9 min-h-touch min-w-touch md:min-h-0 md:min-w-0"
                  onClick={() => setResearchHubOpen((v) => !v)}
                  disabled={isQuerying}
                  aria-label={t("research.hub_open", "ذرائع، حوالہ جات اور علمی پرامپٹس")}
                  title={t("research.hub_open", "ذرائع، حوالہ جات اور علمی پرامپٹس")}
                >
                  <Plus className={cn("h-4 w-4 transition-transform", researchHubOpen && "rotate-45")} />
                  {(hasNarrowedSources || hasActiveAssistModes) && !researchHubOpen && (
                    <span className="absolute end-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </Button>
                {researchHubOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setResearchHubOpen(false)} />
                    <div
                      role="dialog"
                      aria-label={t("research.hub_open", "ذرائع، حوالہ جات اور علمی پرامپٹس")}
                      // QA finding: no cap on this popover's own height meant a
                      // narrow/short viewport could push its bottom off-screen
                      // with no way to reach it (same class of bug as the
                      // agent composer's hub — see ComposerHub.tsx).
                      className="absolute bottom-full start-0 z-50 mb-1 w-[min(21rem,calc(100vw-2rem))] max-h-[min(28rem,70vh)] overflow-y-auto overscroll-contain space-y-1 rounded-lg border border-border bg-popover p-2 text-xs shadow-md"
                    >
                      {onSelectedDomainsChange && (
                        <div className="flex items-center justify-between gap-2 rounded-md px-1 py-1">
                          <span className="text-muted-foreground">{t("research.sources_label")}</span>
                          <SourcePicker
                            selected={selectedDomains}
                            onSelectedChange={onSelectedDomainsChange}
                            requireArabicMatn={requireArabicMatn}
                            onRequireArabicMatnChange={onRequireArabicMatnChange ?? (() => {})}
                            disabled={isQuerying}
                            t={t}
                          />
                        </div>
                      )}
                      {onAssistModesChange && (
                        <div className="rounded-md px-1 py-1.5 border-t border-border">
                          <p className="mb-1.5 text-muted-foreground">{t("research.chips_label")}</p>
                          <ModeChips modes={assistModes} onModesChange={onAssistModesChange} disabled={isQuerying} t={t} />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => { setResearchHubOpen(false); setIsPromptModalOpen(true); }}
                        className="flex w-full items-center gap-1.5 rounded-md border-t border-border px-1 pt-1.5 text-start text-primary hover:bg-primary/10 transition-colors"
                      >
                        <Sparkles className="h-3 w-3 shrink-0" />
                        {t("research.scholarly_prompts", "14 علمی پرامپٹس")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <Textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => { onQueryChange(e.target.value); autoResize(); }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={t("research.ask_placeholder_islamic")}
              aria-label={t("research.ask_placeholder")}
              dir={isRtlQuery ? "rtl" : "ltr"}
              className={cn(
                "min-h-[56px] max-h-[320px] resize-none flex-1 overflow-y-auto border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 text-sm",
                isRtlQuery && "text-end",
              )}
              rows={2}
              title={t("research.send_hint")}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || (!e.ctrlKey && !e.metaKey)) return;
                e.preventDefault();
                if (!query.trim() || isQuerying) return;
                // The button next to this shows the same block visually
                // (disabled); Ctrl+Enter used to just do nothing here.
                if (!isSignedIn) { toast.error(t("research.sign_in_required")); return; }
                if (researchLimitReached) {
                  toast.error(t("research.islamic_limit_reached"));
                  return;
                }
                guardedSendQuery();
              }}
            />
            <Button
              onClick={guardedSendQuery}
              disabled={!query.trim() || isQuerying || researchLimitReached}
              size="icon"
              aria-label={t("research.send", "Send")}
              className="shrink-0 h-9 w-9 min-h-touch min-w-touch md:min-h-0 md:min-w-0 rounded-xl"
            >
              {isQuerying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
      )}

      {!hasCustomComposer && (
      <ScholarlyPromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        onSelectPrompt={(promptText: string, prompt: ScholarlyPromptDef) => {
          // SPEC M10 §1.1 — every query is grounded through islamic-search
          // now (see useResearchChat's runQuery), so a "grounded" prompt no
          // longer needs a mode switch before it can be sent.
          onQueryChange(promptText);
          if (!prompt.corpusReady) {
            toast.warning(t("research.prompt_corpus_pending"));
          }
          setTimeout(() => textareaRef.current?.focus(), 50);
        }}
      />
      )}
    </div>
  );
};

export default ChatDisplay;
