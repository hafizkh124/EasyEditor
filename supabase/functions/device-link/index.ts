// device-link — desktop Google sign-in workaround (2026-09-13).
//
// The desktop (Electron) app cannot use this project's Google OAuth
// provider: that provider only works through Lovable's own managed OAuth
// broker (`lovable.auth.signInWithOAuth`, used by the web app's Login/Signup
// pages), which mediates the browser redirect itself and never exposes real
// Google Cloud credentials to the project — a direct
// `supabase.auth.signInWithOAuth()` call (which is what a `file://`-loaded
// Electron renderer has to fall back to, since it has no origin a provider
// can redirect back to) fails with "Unsupported provider: missing OAuth
// secret". Lovable confirmed there is no supported way to add our own Google
// credentials, and migrating off their managed backend is out of proportion
// for an optional sign-in button (desktop is offline-first; email/password
// already works there).
//
// This function implements a device-authorization-grant-style flow instead
// (RFC 8628, adapted to Supabase sessions — the same shape GitHub CLI/Docker
// Desktop/VS Code use for a native app that cannot embed a browser OAuth
// flow):
//   1. `create`  (no auth)  — desktop asks for a code before it has any
//      session at all.
//   2. `confirm` (auth required) — the user, already signed in on the web
//      app (via the working Google button, or email/password), approves the
//      code from `/connect-device`. This is the only action that ever
//      attaches a real `user_id` to a code, and it comes from the caller's
//      own verified JWT — a client can never confirm a code as someone else.
//   3. `status`  (no auth) — desktop polls this. Once `confirmed`, THIS is
//      also where the hand-off happens: a magic-link token is minted for the
//      confirmed user (service-role `admin.generateLink`) and the row is
//      immediately marked `claimed` so the token is only ever handed out
//      once. Desktop redeems it with `supabase.auth.verifyOtp()`.
//
// No raw access/refresh token ever sits in the table — only the short-lived
// code (8-char Crockford base32, ~40 bits of entropy) does, guarded by a
// 10-minute expiry and rate limiting keyed by both the code and the caller's
// IP (a code is unauthenticated by design, like the RFC's device_code, so IP
// throttling plus the entropy/expiry is what keeps blind guessing
// infeasible — see the two `isRateLimited` calls below).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "npm:zod@^3.25.76";
import { isRateLimited, rateLimitResponse } from "../_shared/rateLimit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32 — no 0/O, 1/I/L confusion
const CODE_LENGTH = 8;
const EXPIRY_MS = 10 * 60 * 1000;
const MAX_CREATE_ATTEMPTS = 5; // collision retries — astronomically unlikely to ever loop

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

function callerIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const RequestSchema = z.object({
  action: z.enum(["create", "status", "confirm"]),
  code: z.string().min(1).max(32).optional(),
});

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed JSON body" }, 400);
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Invalid request", issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const { action, code } = parsed.data;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  if (action === "create") {
    if (isRateLimited(`create:${callerIp(req)}`, 10, 60_000)) return rateLimitResponse(corsHeaders);
    return await createCode(admin);
  }

  if (!code) return json({ error: "code is required" }, 400);

  if (action === "status") {
    if (isRateLimited(`status:${code}`, 60, 60_000) || isRateLimited(`status:${callerIp(req)}`, 120, 60_000)) {
      return rateLimitResponse(corsHeaders);
    }
    return await checkStatus(admin, code);
  }

  // confirm — the only action that requires the caller to actually be signed in.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
  const userId = claimsData.claims.sub as string;

  if (isRateLimited(`confirm:${userId}`, 10, 60_000) || isRateLimited(`confirm:${callerIp(req)}`, 20, 60_000)) {
    return rateLimitResponse(corsHeaders);
  }
  return await confirmCode(admin, code, userId);
}

Deno.serve(handle);

// deno-lint-ignore no-explicit-any
type AdminClient = ReturnType<typeof createClient<any>>;

async function createCode(admin: AdminClient): Promise<Response> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EXPIRY_MS);

  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { error } = await admin.from("device_link_codes").insert({
      code,
      status: "pending",
      expires_at: expiresAt.toISOString(),
    });
    // A unique-index violation (23505) means this exact code is already live
    // — vanishingly unlikely at 32^8 possibilities, but retry rather than
    // fail the user's sign-in attempt over it.
    if (!error) return json({ code, expiresAt: expiresAt.toISOString() });
    if (error.code !== "23505") return json({ error: "Could not create a device code" }, 500);
  }
  return json({ error: "Could not create a device code" }, 500);
}

async function checkStatus(admin: AdminClient, code: string): Promise<Response> {
  const { data: row, error } = await admin
    .from("device_link_codes")
    .select("id, status, user_id, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (error) return json({ error: "Lookup failed" }, 500);
  if (!row) return json({ status: "not_found" }, 404);

  if (row.status === "pending" && new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("device_link_codes").update({ status: "expired" }).eq("id", row.id);
    return json({ status: "expired" });
  }

  if (row.status !== "confirmed") {
    // pending / claimed / expired all report their own status verbatim —
    // "claimed" on a second poll is expected once the hand-off already
    // happened once, not an error.
    return json({ status: row.status });
  }

  // Confirmed — mint the one-time hand-off token and immediately mark this
  // code claimed, so a second `status` poll (this desktop retrying, or
  // anyone else who guessed the code) can never receive a token twice.
  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(row.user_id as string);
  if (userErr || !userData?.user?.email) return json({ error: "Could not resolve the confirming account" }, 500);
  const email = userData.user.email as string;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return json({ error: "Could not mint a sign-in token" }, 500);
  }

  const { error: claimErr } = await admin
    .from("device_link_codes")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "confirmed"); // last-writer-wins guard against a racing second poll
  if (claimErr) return json({ error: "Could not finalize sign-in" }, 500);

  return json({ status: "confirmed", email, tokenHash: linkData.properties.hashed_token });
}

async function confirmCode(admin: AdminClient, code: string, userId: string): Promise<Response> {
  const { data: row, error } = await admin
    .from("device_link_codes")
    .select("id, status, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (error) return json({ error: "Lookup failed" }, 500);
  if (!row) return json({ error: "This code was not found. It may have expired." }, 404);
  if (row.status !== "pending") return json({ error: "This code has already been used." }, 409);
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await admin.from("device_link_codes").update({ status: "expired" }).eq("id", row.id);
    return json({ error: "This code has expired." }, 410);
  }

  const { error: updateErr } = await admin
    .from("device_link_codes")
    .update({ status: "confirmed", user_id: userId, confirmed_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending"); // guard against a double-submit race
  if (updateErr) return json({ error: "Could not confirm this device." }, 500);

  return json({ ok: true });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
