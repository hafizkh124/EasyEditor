import { toast } from "sonner";
import type { PostgrestError } from "@supabase/supabase-js";

// ── Classification tables ──────────────────────────────────────────────────

/** PostgREST / PostgreSQL error codes → friendly message */
const BY_POSTGREST_CODE: Record<string, string> = {
  PGRST116: "No matching record found.",
  "42P01":  "Service setup in progress — try again in a moment.",
  "42501":  "You don't have permission to do that.",
  "23505":  "This record already exists.",
  "23503":  "A related record was not found.",
  "08000":  "Database connection failed — please try again.",
  "08006":  "Database connection failed — please try again.",
};

/** HTTP status codes → friendly message (covers Auth + Edge Function responses) */
const BY_HTTP_STATUS: Record<number, string> = {
  400: "Invalid request — please check your input.",
  401: "Session expired — please sign in again.",
  403: "You don't have permission to do that.",
  404: "Resource not found.",
  409: "Conflicting change — please refresh and try again.",
  429: "You've hit the usage limit — please wait a moment.",
  500: "Server error — please try again.",
  502: "Server error — please try again.",
  503: "Service temporarily unavailable — please try again.",
};

// ── Classifier ─────────────────────────────────────────────────────────────

/**
 * Map any Supabase or network error to a short, human-readable sentence.
 * Never throws — always returns a non-empty string.
 */
export function classifyError(error: unknown): string {
  if (!error) return "An unexpected error occurred.";

  // PostgrestError: has a `code` string field
  const pg = error as Partial<PostgrestError>;
  if (typeof pg.code === "string" && BY_POSTGREST_CODE[pg.code]) {
    return BY_POSTGREST_CODE[pg.code];
  }

  // Errors with an HTTP status (AuthError, Edge Function responses, fetch wrappers)
  const withStatus = error as { status?: number; message?: string };
  if (typeof withStatus.status === "number" && BY_HTTP_STATUS[withStatus.status]) {
    return BY_HTTP_STATUS[withStatus.status];
  }

  // Message-based heuristics (network, parsing, token)
  const msg = (withStatus.message ?? String(error)).toLowerCase();

  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed")) {
    return "Connection lost — check your internet connection.";
  }
  if (msg.includes("load failed")) {
    return "Connection lost — check your internet connection.";
  }
  if (msg.includes("json") || msg.includes("unexpected token") || msg.includes("parse error")) {
    return "Unexpected response from server.";
  }
  if (msg.includes("jwt expired") || msg.includes("invalid jwt") || msg.includes("token is expired")) {
    return "Session expired — please sign in again.";
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return "Request timed out — please try again.";
  }
  if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
    return "Incorrect email or password.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email before signing in.";
  }

  return "Something went wrong — please try again.";
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Show a user-friendly toast and log the full technical error to the console.
 * Returns the friendly message so callers can inspect or re-use it.
 *
 * @param error  Anything thrown or returned as an error by Supabase.
 * @param context  Short label shown in the console prefix, e.g. "load subscription".
 */
export function handleSupabaseError(error: unknown, context?: string): string {
  const friendly = classifyError(error);
  const prefix = context ? `[${context}]` : "[supabase]";
  console.error(`${prefix} ${friendly}`, error);
  toast.error(friendly);
  return friendly;
}

/**
 * Convenience wrapper for Supabase query results that follow the `{ data, error }` shape.
 *
 * - If `error` is present: fires a toast, logs to console, returns `null`.
 * - If `data` is present: returns it.
 * - Both absent (e.g. DELETE with no return): returns `null` silently.
 *
 * @example
 *   const profile = await supabase.from("profiles").select("*").single()
 *     .then(r => wrapSupabase(r, "load profile"));
 */
export function wrapSupabase<T>(
  result: { data: T | null; error: PostgrestError | null },
  context?: string
): T | null {
  if (result.error) {
    handleSupabaseError(result.error, context);
    return null;
  }
  return result.data;
}
