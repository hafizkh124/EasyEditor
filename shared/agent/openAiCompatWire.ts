/**
 * M9 Phase C (ADR-0031) / M10 Phase 2.1 — the OpenAI-compatible wire-format
 * mapping, pulled out of electron/agent/openAiCompatTools.ts so a web
 * `ModelFn` (which calls the `agent-model` edge function instead of a
 * provider directly — M10 §2.1) can share it byte-for-byte rather than
 * reimplementing the same AgentMessage⇄OpenAI translation a second time.
 *
 * Pure — no fetch, no provider key, no Electron/Node/window. The one thing
 * that differs between desktop and web is WHO sends the resulting request
 * (electron/ai/openAiCompatibleClient.ts's `chatCompletion` calls the
 * provider directly with a BYOK key; the web `ModelFn` posts the same shape
 * to `agent-model`, which is billed and has no key of its own yet — that is
 * Phase 2.5) — never the shape of the request or how the response is read.
 */
import type { AgentMessage, AgentTool, ModelStep, ToolParam } from './types.js';

export interface OpenAiToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface OpenAiResponseMessage {
  role: string;
  content: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

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
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** OpenRouter attribution headers — required by their ToS, harmless elsewhere. */
export function openRouterHeaders(providerId: string): Record<string, string> | undefined {
  if (providerId === 'openrouter') {
    return { 'HTTP-Referer': 'https://easyeditor.app', 'X-Title': 'EasyEditor' };
  }
  return undefined;
}

/** The OpenAI response message → the loop's ModelStep contract. */
export function parseModelStep(msg: OpenAiResponseMessage): ModelStep {
  const call = msg.tool_calls?.[0];
  if (call) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* leave empty */ }
    if (call.function.name === 'ask_clarifying_question') {
      const q = String(args.question ?? '').trim();
      if (q) return { kind: 'clarify', question: q };
    }
    if (call.function.name === 'request_mode_upgrade') {
      const targetMode = args.target_mode === 'auto' ? 'auto' : 'plan';
      const reason = String(args.reason ?? '').trim();
      if (reason) return { kind: 'modeUpgrade', targetMode, reason };
    }
    return { kind: 'toolCall', name: call.function.name, args };
  }
  const text = stripThink(msg.content ?? '');
  return { kind: 'text', text: text || '(no response)' };
}
