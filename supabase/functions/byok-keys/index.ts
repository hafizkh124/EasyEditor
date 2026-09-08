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
// edge-function secret (never checked in) via SHA-256. The DB row itself
// has no RLS policy for any client role (see the migration's own comment) —
// this function's service-role client is the only thing that can ever
// reach the table.
//
// Provider info (labels, toolModel, base URLs) is a small, deliberate copy
// of shared/agent/providers.ts's essential fields, not an import — see
// Phase 2.5.1's commit note: edge functions in this repo are self-contained
// (tafsir-proxy's own header comment), and nothing here has verified that a
// relative import escaping supabase/functions/ survives Lovable's deploy
// packaging. Keep the two in sync by hand if a provider or model changes.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@^3.25.76";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ProviderId = "gemini" | "groq" | "openrouter";

interface ProviderSpec {
  label: string;
  kind: "gemini" | "openai-compat";
  baseUrl: string;
  host: string;
  toolModel: string;
}

// Mirrors shared/agent/providers.ts's PROVIDERS — see this file's header.
const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  gemini: { label: "Google Gemini", kind: "gemini", baseUrl: "", host: "generativelanguage.googleapis.com", toolModel: "gemini-2.5-flash" },
  groq: { label: "Groq", kind: "openai-compat", baseUrl: "https://api.groq.com/openai/v1", host: "api.groq.com", toolModel: "openai/gpt-oss-20b" },
  openrouter: { label: "OpenRouter", kind: "openai-compat", baseUrl: "https://openrouter.ai/api/v1", host: "openrouter.ai", toolModel: "google/gemini-2.5-flash" },
};
const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

// ── AES-256-GCM at rest ──────────────────────────────────────────────────

async function deriveKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptKey(plaintext: string, secret: string): Promise<string> {
  const cryptoKey = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.length);
  return toBase64(combined);
}

/** Exported for agent-model (Phase 2.5.3) to decrypt the stored key server-side. */
export async function decryptKey(encoded: string, secret: string): Promise<string> {
  const cryptoKey = await deriveKey(secret);
  const combined = fromBase64(encoded);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ── testing a key (a cheap, one-shot ping — never saves anything) ───────

async function testProviderKey(provider: ProviderId, key: string): Promise<{ success: boolean; message: string }> {
  const spec = PROVIDERS[provider];
  try {
    if (spec.kind === "gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${spec.toolModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { success: false, message: `${spec.label} key قبول نہیں ہوئی (${res.status}): ${text.slice(0, 150)}` };
      }
      return { success: true, message: `${spec.label} key کام کر رہی ہے` };
    }

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

const RequestSchema = z.object({
  action: z.enum(["save", "status", "delete", "test"]),
  provider: z.enum(["gemini", "groq", "openrouter"]).optional(),
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
      const providers = body.provider ? [body.provider] : PROVIDER_IDS;
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
