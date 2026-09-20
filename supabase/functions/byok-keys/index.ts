// byok-keys — M10 Phase 2.5.2 (ADR-0036). Save/status/delete/test a user's
// own Gemini/Groq/OpenRouter key so agent-model can call it instead of the
// paid gateway (Phase 2.5.3 wires that routing; this function only owns
// the key's lifecycle).
//
// The key NEVER round-trips to the browser after it is saved: `save` and
// `test` both take the plaintext key as input (the one moment it exists in
// a request body), but every response — including `save`'s own — carries
// only `{ hasKey, lastFour }`, never the key. `status` is the only read
// path and returns the same shape. There is no "get" action at all.
//
// At rest: AES-256-GCM under a key derived from the PROVIDER_KEY_SECRET
// edge-function secret (never checked in) — see _shared/providerKeyCrypto.ts,
// shared with agent-model so the derivation is byte-for-byte identical. The
// DB row itself has no RLS policy for any client role (see the migration's
// own comment) — this function's service-role client is the only thing that
// can ever reach the table.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@^3.25.76";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";
import { encryptKey } from "../_shared/providerKeyCrypto.ts";
import { PROVIDERS, PROVIDER_IDS, type ProviderId } from "../_shared/providerRegistry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── testing a key (a cheap, one-shot ping — never saves anything) ───────
// Chat providers speak the same OpenAI-compatible /chat/completions
// shape with `Authorization: Bearer <key>`. Cohere speaks the /v2/rerank shape.
async function testProviderKey(provider: string, key: string): Promise<{ success: boolean; message: string }> {
  if (provider === "cohere") {
    try {
      const res = await fetch("https://api.cohere.com/v2/rerank", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "rerank-v3.5",
          query: "test",
          documents: ["test document"],
          top_n: 1,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, message: `Cohere key قبول نہیں ہوئی (${res.status}): ${text.slice(0, 150)}` };
      }
      return { success: true, message: "Cohere Rerank key کام کر رہی ہے" };
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  const spec = PROVIDERS[provider as ProviderId];
  if (!spec) {
    return { success: false, message: `نامعلوم provider: ${provider}` };
  }
  try {
    const res = await fetch(`${spec.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: spec.toolModel, messages: [{ role: "user", content: "Hi" }], max_tokens: 4 }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, message: `${spec.label} key قبول نہیں ہوئی (${res.status}): ${text.slice(0, 150)}` };
    }
    return { success: true, message: `${spec.label} key کام کر رہی ہے` };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// ── request/response ──────────────────────────────────────────────────────

const ALL_BYOK_PROVIDERS = [...PROVIDER_IDS, "cohere"] as const;

const RequestSchema = z.object({
  action: z.enum(["save", "status", "delete", "test"]),
  provider: z.enum(["gemini", "groq", "openrouter", "cohere"]).optional(),
  key: z.string().min(10).max(500).optional(),
});

function lastFourOf(key: string): string {
  return key.slice(-4);
}

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

    if (isRateLimited(user.id, 20, 60_000)) {
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

    if (body.action === "status") {
      const providers = body.provider ? [body.provider] : (ALL_BYOK_PROVIDERS as readonly string[]);
      const { data, error } = await supabase
        .from("user_provider_keys")
        .select("provider, last_four")
        .eq("user_id", user.id)
        .in("provider", providers);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const byProvider = new Map((data ?? []).map((r: { provider: string; last_four: string }) => [r.provider, r.last_four]));
      const result: Record<string, { hasKey: boolean; lastFour: string | null }> = {};
      for (const p of providers) {
        result[p] = byProvider.has(p) ? { hasKey: true, lastFour: byProvider.get(p)! } : { hasKey: false, lastFour: null };
      }
      return new Response(JSON.stringify(body.provider ? result[body.provider] : result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "delete") {
      if (!body.provider) {
        return new Response(JSON.stringify({ error: "provider is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase
        .from("user_provider_keys")
        .delete()
        .eq("user_id", user.id)
        .eq("provider", body.provider);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.action === "test") {
      if (!body.provider || !body.key) {
        return new Response(JSON.stringify({ error: "provider and key are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await testProviderKey(body.provider, body.key);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // save
    if (!body.provider || !body.key) {
      return new Response(JSON.stringify({ error: "provider and key are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const secret = Deno.env.get("PROVIDER_KEY_SECRET");
    if (!secret) {
      return new Response(JSON.stringify({ error: "Server is not configured for BYOK yet (PROVIDER_KEY_SECRET missing)." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const encrypted = await encryptKey(body.key, secret);
    const lastFour = lastFourOf(body.key);
    const { error } = await supabase
      .from("user_provider_keys")
      .upsert(
        { user_id: user.id, provider: body.provider, encrypted_key: encrypted, last_four: lastFour, updated_at: new Date().toISOString() },
        { onConflict: "user_id,provider" },
      );
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ hasKey: true, lastFour }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("byok-keys error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

serve(handle);
