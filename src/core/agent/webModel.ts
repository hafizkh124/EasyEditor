/**
 * M10 Phase 2.1 — the web agent's `ModelFn`.
 *
 * Desktop's ModelFn (electron/agent/modelRouter.ts) picks a BYOK provider and
 * calls it directly. Web has no server-side key store yet (Phase 2.5), so
 * this always calls the `agent-model` edge function on Gemini/Lovable — but
 * the AgentMessage <-> OpenAI wire-format translation is the EXACT SAME code
 * electron/agent/openAiCompatTools.ts uses (shared/agent/openAiCompatWire.ts,
 * extracted in Phase 2.1 slice 1 for exactly this reuse), so a bug fixed in
 * one platform's wire mapping is fixed in both.
 */
import { callEdgeFunction } from "@/core/ai/aiAdapter";
import {
  toOpenAiTools, toOpenAiMessages, parseModelStep, type OpenAiResponseMessage,
} from "~shared/agent/openAiCompatWire";
import type { AgentMessage, AgentTool, ModelStep } from "~shared/agent/types";

/** Matches the "google/<model>" convention every other edge function caller uses
 *  (research-query, refine-text, …) — agent-model strips no prefix itself, it
 *  hands the string straight to callChatCompletions, which does. */
const WEB_AGENT_MODEL = "google/gemini-2.5-flash";

export async function webAgentModel(
  messages: AgentMessage[],
  tools: AgentTool[],
  systemPrompt: string,
): Promise<ModelStep> {
  const body: Record<string, unknown> = {
    model: WEB_AGENT_MODEL,
    messages: toOpenAiMessages(systemPrompt, messages),
    ...(tools.length ? { tools: toOpenAiTools(tools), tool_choice: "auto" } : {}),
  };
  const { data, error } = await callEdgeFunction("agent-model", body);
  if (error) throw new Error(error.message || "agent-model کال ناکام ہوئی۔");
  return parseModelStep(data as OpenAiResponseMessage);
}

/**
 * Plain text generation (no tools) — the web counterpart of
 * electron/agent/modelRouter.ts's `generateAgentText`, for the tools that
 * call the model directly rather than through the agent loop
 * (draft_section, critique). Same `agent-model` endpoint, same billing.
 */
export async function generateWebAgentText(opts: {
  prompt: string;
  systemInstruction?: string;
  temperature?: number;
}): Promise<string> {
  const messages: OpenAiResponseMessage[] = [
    ...(opts.systemInstruction ? [{ role: "system", content: opts.systemInstruction }] : []),
    { role: "user", content: opts.prompt },
  ] as OpenAiResponseMessage[];
  const body: Record<string, unknown> = {
    model: WEB_AGENT_MODEL,
    messages,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  };
  const { data, error } = await callEdgeFunction("agent-model", body);
  if (error) throw new Error(error.message || "agent-model کال ناکام ہوئی۔");
  const msg = data as OpenAiResponseMessage;
  return (msg?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
