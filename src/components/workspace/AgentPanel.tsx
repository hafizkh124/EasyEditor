import React from "react";
import { Bot, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentRun } from "@/hooks/useAgentRun";
import { AgentComposer } from "./AgentComposer";
import ChatDisplay from "@/components/research/ChatDisplay";

/**
 * SPEC-M8 Layer 6 / P8b — the Agent tab. Two modes: "Ask" (read-only) and
 * "Do" (tracked-change edits). Every step shows a live present-tense line
 * (§3 UI shape — a trust requirement, not decoration). `/` opens a playbook
 * picker, `@` a mention picker (chapters + the open document's outline +
 * matching Shamela books). A microphone dictates into the chat box via the
 * existing local Whisper. Desktop + VITE_AGENT_MODE only; needs an open
 * project folder.
 *
 * SPEC M10 §1.2 — composes AgentComposer (shell + input) around ChatDisplay
 * (the run timeline, via its `agent_run` item) instead of rendering either
 * inline. This is the exact same pair the merged research+agent panel's
 * agent branch uses — this file now just supplies the project-folder-needed
 * empty state and wires the two together.
 *
 * No longer routed to. WorkbenchPanel's separate "agent" tab is gone —
 * ResearchPanel.tsx now decides internally whether to show this same
 * AgentComposer+ChatDisplay pair (open project folder + wb.agent available)
 * or plain research chat, so this component is unreachable from any tab.
 * Kept, not deleted: agentPanel.test.tsx's 16 cases are real regression
 * coverage of the underlying composition ResearchPanel's agent branch also
 * uses (mode toggle, sending, mentions, playbooks, dictation, drag-drop,
 * consent cards) — migrating them onto ResearchPanel directly (a larger
 * mock surface: auth/subscription/token-balance) is follow-up work, not
 * done here to avoid discovering new integration issues under time
 * pressure on the app's most complex screen.
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
    <AgentComposer agent={a}>
      <ChatDisplay
        // Research-only props ChatDisplay still requires but does not use
        // while `composer` is supplied — see its own doc comment.
        messages={[]}
        query=""
        onQueryChange={() => {}}
        onSendQuery={() => {}}
        isRefining={false}
        lastAssistantIdx={-1}
        onRefine={() => {}}
        onCopyOutput={() => {}}
        onClearChat={a.clearConversation}
        onRegenerate={() => {}}
        researchLimitReached={false}
        chatEndRef={{ current: null }}
        t={t}
        isQuerying={a.running}
        agent={a}
        composer={null}
      />
    </AgentComposer>
  );
};
