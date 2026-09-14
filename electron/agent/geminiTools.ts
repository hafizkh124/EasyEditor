/**
 * M8 Layer 6 — Gemini function-calling for the agent (SPEC-M8 §3).
 *
 * `generateWithTools` is the real `ModelFn` the loop runs with. It converts
 * the closed tool registry to Gemini `functionDeclarations`, sends the running
 * conversation, and returns either a final text answer or one tool call.
 *
 * Non-streaming: the loop already emits its own step-by-step progress, and a
 * function-call response has nothing useful to stream token by token.
 */
import { getDecryptedGeminiKey } from '../ai/keyStore.js';
import { logger } from '../lib/logger.js';
import type { AgentMessage, AgentTool, ModelStep, ToolParam } from '../../shared/agent/types.js';

const log = logger.child('agent/gemini');

function paramSchema(p: ToolParam): Record<string, unknown> {
  const s: Record<string, unknown> = { type: p.type.toUpperCase(), description: p.description };
  if (p.enum) s.enum = p.enum;
  if (p.type === 'array' && p.items) s.items = { type: p.items.type.toUpperCase() };
  return s;
}

function toFunctionDeclarations(tools: AgentTool[]): unknown[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: {
      type: 'OBJECT',
      properties: Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, paramSchema(v)])),
      ...(t.required.length ? { required: t.required } : {}),
    },
  }));
}

/** The running conversation → Gemini `contents`. */
function toContents(messages: AgentMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'user') return { role: 'user', parts: [{ text: m.text }] };
    if (m.role === 'model') {
      return m.toolCall
        ? { role: 'model', parts: [{ functionCall: { name: m.toolCall.name, args: m.toolCall.args } }] }
        : { role: 'model', parts: [{ text: m.text ?? '' }] };
    }
    // tool result
    return { role: 'user', parts: [{ functionResponse: { name: m.name, response: { result: m.result } } }] };
  });
}

export async function generateWithTools(
  messages: AgentMessage[],
  tools: AgentTool[],
  systemPrompt: string,
  opts: { forceCall?: boolean } = {},
): Promise<ModelStep> {
  const key = await getDecryptedGeminiKey();
  if (!key) throw new Error('کوئی Gemini key پاس نہیں کی گئی — Settings میں اپنی کلید درج کریں');

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: toContents(messages),
    generationConfig: { temperature: 0.2 },
  };
  if (tools.length) {
    body.tools = [{ functionDeclarations: toFunctionDeclarations(tools) }];
    // Playbook bind steps force a call to the one tool they were given (ADR-0020).
    body.toolConfig = { functionCallingConfig: opts.forceCall ? { mode: 'ANY', allowedFunctionNames: tools.map((t) => t.name) } : { mode: 'AUTO' } };
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args?: Record<string, unknown> } }> } }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];

  const call = parts.find((p) => p.functionCall)?.functionCall;
  if (call) {
    // The clarify pseudo-tool (ADR-0027 F6): the model asks one question.
    if (call.name === 'ask_clarifying_question') {
      const q = String((call.args ?? {}).question ?? '').trim();
      if (q) return { kind: 'clarify', question: q };
    }
    // The mode-upgrade pseudo-tool (M11, Ask mode only): the model asks to
    // switch to Plan/Auto instead of refusing a write it can't do.
    if (call.name === 'request_mode_upgrade') {
      const args = call.args ?? {};
      const targetMode = args.target_mode === 'auto' ? 'auto' : 'plan';
      const reason = String(args.reason ?? '').trim();
      if (reason) return { kind: 'modeUpgrade', targetMode, reason };
    }
    return { kind: 'toolCall', name: call.name, args: call.args ?? {} };
  }
  const text = parts.map((p) => p.text).filter(Boolean).join('').trim();
  if (!text) {
    log.warn('empty model response', { parts: parts.length });
    return { kind: 'text', text: '(no response)' };
  }
  return { kind: 'text', text };
}

/**
 * A scoped, forced call to exactly ONE tool — the mechanism a playbook bind
 * step uses (ADR-0020). The model cannot pick another tool, answer with text,
 * or refuse; it must return this call with its args filled.
 */
export async function generateBoundCall(
  messages: AgentMessage[],
  tool: AgentTool,
  systemPrompt: string,
): Promise<{ name: string; args: Record<string, unknown> }> {
  const step = await generateWithTools(messages, [tool], systemPrompt, { forceCall: true });
  if (step.kind === 'toolCall') return { name: step.name, args: step.args };
  throw new Error(`bound step expected a ${tool.name} call, got ${step.kind}`);
}
