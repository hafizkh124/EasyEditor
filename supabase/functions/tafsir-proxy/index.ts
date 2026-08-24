// Tafsir MCP — web proxy (ADR-0012, SPEC-TAFSIR §FR-6).
//
// Web counterpart to `electron/tafsir/mcpClient.ts`. The desktop client
// holds one module-level session per Electron main process (one desktop
// user each). This function serves many concurrent web users from a warm,
// possibly-shared isolate, so it holds no session at all: every action
// opens a fresh MCP client, does its work, and closes it. The remote server
// itself is stateless (confirmed in the SPEC-TAFSIR Phase-0 spike — no
// `Mcp-Session-Id`, every POST self-contained), so nothing is lost by not
// keeping a connection open between requests.
//
// `TAFSIR_TOOL_ALLOWLIST` / `validateToolArgs` below are a direct port of
// `electron/tafsir/allowlist.ts` — same 17 tools, same argument schema and
// sanitization. Edge functions in this repo are self-contained (no import
// from `src/` or `electron/`), so this is a copy, not a shared import; keep
// the two in sync if the allowlist ever changes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Client } from "npm:@modelcontextprotocol/sdk@1.28.0/client/index.js";
import { StreamableHTTPClientTransport } from "npm:@modelcontextprotocol/sdk@1.28.0/client/streamableHttp.js";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { calculateCost, checkAndDeductTokens, refundTokens, insufficientTokensResponse } from "../_shared/tokenGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REMOTE_ENDPOINT = "https://mcp.tafsir.net/mcp";
const TIMEOUT_MS = 15_000;
const MAX_RESULT_CHARS = 50_000;

// ── Allowlist (ported from electron/tafsir/allowlist.ts) ────────────────────

type ToolArgType = "number" | "string" | "boolean" | "string[]";

interface ToolSpec {
  name: string;
  title?: string;
  args?: Record<string, ToolArgType>;
}

const TAFSIR_TOOL_ALLOWLIST: ToolSpec[] = [
  { name: "fetch_ayah", title: "آیت", args: { surah: "number", ayah: "number", include: "string[]" } },
  { name: "fetch_tafsir", title: "تفسیر", args: { surah: "number", ayah: "number", sources: "string[]", part: "number" } },
  { name: "list_tafsir_sources", title: "تفاسیر کے مصدر" },
  { name: "list_science_sources", title: "علوم قرآن کے مصدر" },
  { name: "list_all_sources", title: "تمام مصدر" },
  { name: "list_sources_for_ayah", title: "آیت کے مصدر", args: { surah: "number", ayah: "number" } },
  { name: "fetch_nuzool_reason", title: "سبب نزول", args: { surah: "number", ayah: "number", sources: "string[]", part: "number" } },
  { name: "fetch_surah_info", title: "سورہ معلومات", args: { surah: "number", include_en_intro: "boolean" } },
  { name: "analyze_word", title: "لفظی تجزیہ", args: { surah: "number", ayah: "number", word_no: "number", aspects: "string[]" } },
  { name: "find_root_occurrences", title: "جذر کے وقوعات", args: { root: "string", limit: "number" } },
  { name: "get_root_stats", title: "جذر کے اعداد", args: { root: "string" } },
  { name: "get_qeraat_variants", title: "قراءات", args: { surah: "number", ayah: "number", word_no: "number" } },
  { name: "search_quran_text", title: "قرآنی تلاش", args: { query: "string", surah_filter: "number", limit: "number" } },
  { name: "search_in_tafsir", title: "تفسیر میں تلاش", args: { query: "string", source: "string", surah_filter: "number", surah: "number", limit: "number" } },
  { name: "get_quran_overview", title: "قرآن مجموعی جائزہ" },
  { name: "get_page_fawaed", title: "صفحہ کے فوائد", args: { page: "number" } },
  { name: "get_surah_statistics", title: "سورہ اعداد", args: { surah: "number" } },
];

const NUMBER_MIN = 0;
const NUMBER_MAX = 100_000;

function getToolSpec(name: string): ToolSpec | undefined {
  return TAFSIR_TOOL_ALLOWLIST.find((t) => t.name === name);
}

function validateToolArgs(name: string, rawArgs: unknown): Record<string, unknown> {
  const spec = getToolSpec(name);
  if (!spec) {
    throw new Error(`نامعلوم ٹول: ${name} — Tafsir MCP کی سفید فہرست میں نہیں ہے۔`);
  }
  const schema = spec.args ?? {};
  if (rawArgs === undefined || rawArgs === null) rawArgs = {};
  if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    throw new Error(`ٹول ${name} کے دلائل ایک آبجیکٹ ہونے چاہئیں۔`);
  }
  const input = rawArgs as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [key, type] of Object.entries(schema)) {
    const value = input[key];
    if (value === undefined) continue; // Optional args are omitted — server fills defaults.
    switch (type) {
      case "number": {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) throw new Error(`ٹول ${name} کا دلیل ${key} ایک عدد ہونا چاہیے۔`);
        out[key] = Math.min(NUMBER_MAX, Math.max(NUMBER_MIN, Math.trunc(n)));
        break;
      }
      case "string": {
        out[key] = (typeof value === "string" ? value : String(value)).trim();
        break;
      }
      case "boolean": {
        if (typeof value !== "boolean") throw new Error(`ٹول ${name} کا دلیل ${key} ایک بولین ہونا چاہیے۔`);
        out[key] = value;
        break;
      }
      case "string[]": {
        if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
          throw new Error(`ٹول ${name} کا دلیل ${key} سٹرنگز کی ایک فہرست ہونی چاہیے۔`);
        }
        out[key] = (value as string[]).map((v) => v.trim()).filter((v) => v.length > 0);
        break;
      }
    }
  }
  return out;
}

// ── Remote MCP access (session-less — see header comment) ───────────────────

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ریموٹ سرور نے جواب دینے میں بہت وقت لیا۔")), TIMEOUT_MS);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** Raw JSON-RPC `initialize` POST — no SDK Client needed for a bare health check. */
async function pingRemote(): Promise<{ ok: boolean; latencyMs: number | null; error?: string }> {
  const started = Date.now();
  try {
    const res = await fetch(REMOTE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": "easy-editor-tafsir-proxy/1.0.0",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "easy-editor-tafsir-proxy", version: "1.0.0" },
        },
      }),
    });
    if (res.status >= 400) return { ok: false, latencyMs: null, error: `HTTP ${res.status}` };
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, latencyMs: null, error: err instanceof Error ? err.message : String(err) };
  }
}

interface ToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Opens a fresh client for one request, always closes it before returning. */
async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "easy-editor-tafsir-proxy", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(REMOTE_ENDPOINT));
  try {
    await withTimeout(client.connect(transport));
    return await fn(client);
  } finally {
    try { await client.close(); } catch { /* ignore */ }
    try { await transport.close(); } catch { /* ignore */ }
  }
}

async function connectAndListTools(): Promise<{ server?: string; version?: string; tools: ToolInfo[] }> {
  return withClient(async (client) => {
    const tools = await withTimeout(client.listTools());
    const server = client.getServerVersion();
    return {
      server: server?.name,
      version: server?.version,
      tools: tools.tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    };
  });
}

async function callTool(name: string, rawArgs: unknown) {
  const safeArgs = validateToolArgs(name, rawArgs);
  return withClient(async (client) => {
    const result = (await withTimeout(client.callTool({ name, arguments: safeArgs }))) as {
      content?: Array<{ type: string; text?: string }>;
      structuredContent?: unknown;
    };
    const blocks = Array.isArray(result.content)
      ? result.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text as string)
      : [];
    const full = blocks.join("\n");
    const truncated = full.length > MAX_RESULT_CHARS;
    return {
      tool: name,
      text: truncated ? full.slice(0, MAX_RESULT_CHARS) : full,
      length: full.length,
      truncated,
      structured: result.structuredContent ?? undefined,
    };
  });
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

/**
 * Exported so the request logic is reachable from a test. Everything below
 * used to live inside an anonymous `serve(async (req) => …)`, which left the
 * HTTP layer — validation, auth rejection, error mapping, CORS on error
 * responses — verifiable only by the post-deploy smoke script.
 */
export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    if (isRateLimited(userId, 30, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }

    const { action, tool, args } = await req.json();

    // `ping` and `connect` are connectivity/discovery, not content — free,
    // same as checking whether the Shamela bridge is reachable costs nothing.
    // Only `call` (an actual tool invocation) is billed.
    switch (action) {
      case "ping": {
        const result = await pingRemote();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "connect":
      case "tools": {
        try {
          const result = await connectAndListTools();
          return new Response(JSON.stringify({ connected: true, ...result }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          return new Response(
            JSON.stringify({ connected: false, tools: [], error: err instanceof Error ? err.message : String(err) }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      case "call": {
        if (typeof tool !== "string" || !getToolSpec(tool)) {
          return new Response(
            JSON.stringify({ error: `نامعلوم یا غیر مجاز ٹول: ${String(tool)}` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const tokenCost = calculateCost("tafsir", 1);
        const tokenResult = await checkAndDeductTokens(supabase, userId, tokenCost, "tafsir", `tafsir:${tool}`);
        if (!tokenResult.ok) {
          return insufficientTokensResponse(tokenResult, corsHeaders);
        }

        try {
          const result = await callTool(tool, args);
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch (err) {
          await refundTokens(supabase, userId, tokenCost, "tafsir", "MCP call failed — refund");
          return new Response(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
            { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      default:
        return new Response(JSON.stringify({ error: `نامعلوم action: ${String(action)}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    console.error("tafsir-proxy error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

Deno.serve(handle);
