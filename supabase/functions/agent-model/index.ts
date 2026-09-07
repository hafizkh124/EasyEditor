// agent-model — M10 Phase 2.1 (ADR-0034 follow-up). The web agent's model
// call. shared/agent/loop.ts is pure and already runs the same way in the
// browser as it does in the Electron main process; the one thing it cannot
// do from a browser is call Gemini/Groq/OpenRouter directly (no server-side
// BYOK key store yet — that is Phase 2.5). Until then this is the desktop's
// modelRouter.ts's web counterpart: authenticate, meter, and forward to the
// SAME `_shared/aiGateway.ts` every other edge function already uses.
//
// Deliberately thin: the AgentMessage ⇄ OpenAI wire-format mapping
// (toOpenAiMessages/toOpenAiTools/parseModelStep) lives in
// shared/agent/openAiCompatWire.ts and runs CLIENT-SIDE (src/core/agent's
// web ModelFn) — this function only ever sees an already-OpenAI-shaped body
// and hands back an already-OpenAI-shaped message, exactly the contract
// electron/ai/openAiCompatibleClient.ts's `chatCompletion` returns, so the
// same `parseModelStep` runs unmodified on both platforms.
//
// No baseUrl parameter exists yet: callChatCompletions only ever calls our
// own Gemini-direct / Lovable endpoints, so there is no user-controlled
// fetch target to allowlist here. Phase 2.5 (BYOK) will add one — and MUST
// route it through electron/lib/agentModelAllowlist.ts's shared allowlist
// (per the M10 plan's own note), not a bespoke check, before this function
// ever forwards to a provider host it does not already hardcode.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@^3.25.76";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";
import { callChatCompletions } from "../_shared/aiGateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Loose on purpose — an OpenAI-shaped message varies by role (system/user
// have plain string content; assistant may carry tool_calls with a null
// content; tool carries tool_call_id). This exists to catch a malformed or
// wildly oversized body, not to re-derive the whole OpenAI schema.
const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().nullable().optional(),
  tool_call_id: z.string().optional(),
  tool_calls: z.array(z.object({
    id: z.string(),
    type: z.literal("function"),
    function: z.object({ name: z.string(), arguments: z.string() }),
  })).optional(),
});

const ToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown()),
  }),
});

const RequestSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z.array(MessageSchema).min(1).max(200),
  tools: z.array(ToolSchema).max(50).optional(),
  tool_choice: z.union([
    z.literal("auto"), z.literal("none"), z.literal("required"),
    z.object({ type: z.literal("function"), function: z.object({ name: z.string() }) }),
  ]).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().max(32000).optional(),
});

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The agent loop calls this once per step (up to DEFAULT_MAX_STEPS = 16
    // in shared/agent/loop.ts); a burst from one run is expected.
    if (isRateLimited(user.id, 40, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Malformed JSON body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const parsed = RequestSchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", issues: parsed.error.issues.slice(0, 5) }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsed.data;

    const tokenCost = calculateCost("agent_step", 1);
    const tokenResult = await checkAndDeductTokens(
      supabase, user.id, tokenCost, "agent_step",
      `Agent model call: ${body.model}`,
    );
    if (!tokenResult.ok) {
      return insufficientTokensResponse(tokenResult, corsHeaders);
    }

    let res: Response;
    try {
      res = await callChatCompletions({
        model: body.model,
        messages: body.messages,
        ...(body.tools?.length ? { tools: body.tools, tool_choice: body.tool_choice ?? "auto" } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
      });
    } catch (e) {
      await refundTokens(supabase, user.id, tokenCost, "agent_step", "AI gateway threw");
      throw e;
    }

    if (!res.ok) {
      await refundTokens(supabase, user.id, tokenCost, "agent_step", `AI gateway ${res.status}`);
      const text = await res.text().catch(() => "");
      return new Response(JSON.stringify({ error: `Model call failed (${res.status})`, detail: text.slice(0, 500) }), {
        status: res.status >= 500 ? 502 : res.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json().catch(() => null) as { choices?: Array<{ message?: unknown }> } | null;
    const message = data?.choices?.[0]?.message;
    if (!message) {
      await refundTokens(supabase, user.id, tokenCost, "agent_step", "provider returned no message");
      return new Response(JSON.stringify({ error: "Model returned no message" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(message), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("agent-model error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(handle);
