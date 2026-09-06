/**
 * M9 Phase C (ADR-0031) — the OpenAI-compatible `ModelFn` for the agent.
 *
 * Mirrors electron/agent/geminiTools.ts for a `kind: 'openai-compat'` provider
 * (Groq, OpenRouter). It owns the wire-format mapping that differs from Gemini
 * (blueprint §4):
 *
 *   Gemini                              OpenAI-compatible
 *   ─────────────────────────────────   ─────────────────────────────────
 *   tool result: role 'user' +          role 'tool' + tool_call_id
 *     functionResponse
 *   schema types UPPERCASE              JSON Schema lowercase
 *   functionCallingConfig mode 'ANY'    tool_choice {type:'function',…}
 *   header x-goog-api-key               Authorization: Bearer
 *
 * The AgentMessage stream carries no tool-call ids, so they are synthesised and
 * paired positionally — safe because the loop is strictly
 * assistant-toolCall → tool-result alternating.
 */
import { chatCompletion, type OpenAiMessage, type OpenAiToolSchema } from '../ai/openAiCompatibleClient.js';
import type { ProviderSpec } from '../../shared/agent/providers.js';
import type { AgentMessage, AgentTool, ModelStep, ToolParam } from '../../shared/agent/types.js';

function paramSchema(p: ToolParam): Record<string, unknown> {
  const s: Record<string, unknown> = { type: p.type, description: p.description };
  if (p.enum) s.enum = p.enum;
  if (p.type === 'array' && p.items) s.items = { type: p.items.type };
  return s;
}

export function toOpenAiTools(tools: AgentTool[]): OpenAiToolSchema[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, paramSchema(v)])),
        ...(t.required.length ? { required: t.required } : {}),
        additionalProperties: false,
      },
    },
  }));
}

export function toOpenAiMessages(systemPrompt: string, messages: AgentMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: systemPrompt }];
  let n = 0;
  let lastToolCallId = 'call_0';
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.text });
    } else if (m.role === 'model') {
      if (m.toolCall) {
        lastToolCallId = `call_${n++}`;
        out.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: lastToolCallId,
            type: 'function',
            function: { name: m.toolCall.name, arguments: JSON.stringify(m.toolCall.args ?? {}) },
          }],
        });
      } else {
        out.push({ role: 'assistant', content: m.text ?? '' });
      }
    } else {
      // tool result — pairs with the assistant tool_call just emitted
      out.push({
        role: 'tool',
        tool_call_id: lastToolCallId,
        content: typeof m.result === 'string' ? m.result : JSON.stringify(m.result),
      });
    }
  }
  return out;
}

/** Reasoning models wrap their scratchpad in <think>…</think> — strip it. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extraHeaders(provider: ProviderSpec): Record<string, string> | undefined {
  if (provider.id === 'openrouter') {
    return { 'HTTP-Referer': 'https://easyeditor.app', 'X-Title': 'EasyEditor' };
  }
  return undefined;
}

export interface OpenAiCompatModel {
  /** The ModelFn the agent loop runs with. */
  generate: (messages: AgentMessage[], tools: AgentTool[], systemPrompt: string) => Promise<ModelStep>;
  /** A forced single-tool call — the playbook bind mechanism (ADR-0020). */
  generateBound: (messages: AgentMessage[], tool: AgentTool, systemPrompt: string) => Promise<{ name: string; args: Record<string, unknown> }>;
}

export function makeOpenAiCompatModel(provider: ProviderSpec, apiKey: string, opts: { model?: string } = {}): OpenAiCompatModel {
  const model = opts.model ?? provider.toolModel;
  const common = { baseUrl: provider.baseUrl, apiKey, model, extraHeaders: extraHeaders(provider) };

  const parse = (msg: Awaited<ReturnType<typeof chatCompletion>>): ModelStep => {
    const call = msg.tool_calls?.[0];
    if (call) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* leave empty */ }
      if (call.function.name === 'ask_clarifying_question') {
        const q = String(args.question ?? '').trim();
        if (q) return { kind: 'clarify', question: q };
      }
      return { kind: 'toolCall', name: call.function.name, args };
    }
    const text = stripThink(msg.content ?? '');
    return { kind: 'text', text: text || '(no response)' };
  };

  return {
    async generate(messages, tools, systemPrompt) {
      const msg = await chatCompletion({
        ...common,
        messages: toOpenAiMessages(systemPrompt, messages),
        ...(tools.length ? { tools: toOpenAiTools(tools), toolChoice: 'auto' as const } : {}),
      });
      return parse(msg);
    },

    async generateBound(messages, tool, systemPrompt) {
      const msg = await chatCompletion({
        ...common,
        messages: toOpenAiMessages(systemPrompt, messages),
        tools: toOpenAiTools([tool]),
        toolChoice: { type: 'function', function: { name: tool.name } },
      });
      const step = parse(msg);
      if (step.kind === 'toolCall') return { name: step.name, args: step.args };
      throw new Error(`bound step expected a ${tool.name} call, got ${step.kind}`);
    },
  };
}
