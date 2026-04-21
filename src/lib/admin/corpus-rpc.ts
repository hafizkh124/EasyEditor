import { supabase } from "@/integrations/supabase/client";

// These tables/RPCs may not be present in the generated Supabase types
// until the corpus migration is applied. Centralize the untyped access here.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CorpusStat {
  domain: string;
  source_type: string;
  total: number;
  embedded: number;
}

export interface IngestJob {
  id: string;
  dataset: string;
  status: string;
  total_rows: number | null;
  processed: number;
  errors: number;
  started_at: string | null;
}

export async function fetchCorpusStats(): Promise<CorpusStat[]> {
  const { data, error } = await (supabase.rpc as any)("scholarly_documents_stats");
  if (error || !data) return [];
  return data as CorpusStat[];
}

export async function fetchIngestJobs(): Promise<IngestJob[]> {
  const { data, error } = await (supabase.from as any)("ingest_jobs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(20);
  if (error || !data) return [];
  return data as IngestJob[];
}

export async function fetchCacheCount(): Promise<number> {
  const { count, error } = await (supabase.from as any)("api_response_cache")
    .select("cache_key", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}

export async function purgeExpiredCache(): Promise<{ ok: boolean; message?: string }> {
  const { error } = await (supabase.rpc as any)("purge_expired_cache");
  return error ? { ok: false, message: error.message as string } : { ok: true };
}

export async function resetMonthlyQuotas(): Promise<{ ok: boolean; message?: string }> {
  const { error } = await (supabase.rpc as any)("reset_monthly_quotas");
  return error ? { ok: false, message: error.message as string } : { ok: true };
}
