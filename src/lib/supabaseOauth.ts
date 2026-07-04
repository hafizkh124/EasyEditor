// Typed shim for Supabase's beta `supabase.auth.oauth` namespace used by the
// managed OAuth server / MCP consent flow. Keeps TypeScript happy without
// waiting for the beta types to land in @supabase/supabase-js.
import { supabase } from "@/integrations/supabase/client";

type AuthorizationDetails = {
  client?: { name?: string; logo_uri?: string | null; client_uri?: string | null };
  scopes?: string[];
  redirect_url?: string;
  redirect_to?: string;
  expires_at?: string | number | null;
};

type OAuthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: { message: string } | null }>;
  approveAuthorization: (
    id: string,
  ) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
  denyAuthorization: (
    id: string,
  ) => Promise<{ data: { redirect_url?: string; redirect_to?: string } | null; error: { message: string } | null }>;
};

export function getSupabaseOauth(): OAuthApi {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = (supabase.auth as any).oauth as OAuthApi | undefined;
  if (!api) {
    throw new Error(
      "Supabase OAuth server APIs are not available in this client build.",
    );
  }
  return api;
}

export type { AuthorizationDetails };
