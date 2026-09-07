/**
 * M9 Phase C (ADR-0031) — the OpenAI-compatible `ModelFn` for the agent.
 *
 * Mirrors electron/agent/geminiTools.ts for a `kind: 'openai-compat'` provider
 * (Groq, OpenRouter). The wire-format mapping itself (blueprint §4 — tool
 * result role, JSON-Schema case, tool_choice shape, auth header) moved to
 * shared/agent/openAiCompatWire.ts in M10 Phase 2.1, so the web `ModelFn`
 * (which posts the same shape to the `agent-model` edge function instead of
 * calling a provider directly) shares it rather than reimplementing it. This
 * file now only owns what stays genuinely desktop-only: sending the request
 * with a BYOK key via `chatCompletion`.
 */
import { chatCompletion } from '../ai/openAiCompatibleClient.js';
import {
  toOpenAiTools, toOpenAiMessages, parseModelStep, openRouterHeaders,
} from '../../shared/agent/openAiCompatWire.js';
import type { ProviderSpec } from '../../shared/agent/providers.js';
import type { AgentMessage, AgentTool, ModelStep } from '../../shared/agent/types.js';

export { toOpenAiTools, toOpenAiMessages };

export interface OpenAiCompatModel {
  /** The ModelFn the agent loop runs with. */
  generate: (messages: AgentMessage[], tools: AgentTool[], systemPrompt: string) => Promise<ModelStep>;
  /** A forced single-tool call — the playbook bind mechanism (ADR-0020). */
  generateBound: (messages: AgentMessage[], tool: AgentTool, systemPrompt: string) => Promise<{ name: string; args: Record<string, unknown> }>;
}

export function makeOpenAiCompatModel(provider: ProviderSpec, apiKey: string, opts: { model?: string } = {}): OpenAiCompatModel {
  const model = opts.model ?? provider.toolModel;
  const common = { baseUrl: provider.baseUrl, apiKey, model, extraHeaders: openRouterHeaders(provider.id) };

  return {
    async generate(messages, tools, systemPrompt) {
      const msg = await chatCompletion({
        ...common,
        messages: toOpenAiMessages(systemPrompt, messages),
        ...(tools.length ? { tools: toOpenAiTools(tools), toolChoice: 'auto' as const } : {}),
      });
      return parseModelStep(msg);
    },

    async generateBound(messages, tool, systemPrompt) {
      const msg = await chatCompletion({
        ...common,
        messages: toOpenAiMessages(systemPrompt, messages),
        tools: toOpenAiTools([tool]),
        toolChoice: { type: 'function', function: { name: tool.name } },
      });
      const step = parseModelStep(msg);
      if (step.kind === 'toolCall') return { name: step.name, args: step.args };
      throw new Error(`bound step expected a ${tool.name} call, got ${step.kind}`);
    },
  };
}
