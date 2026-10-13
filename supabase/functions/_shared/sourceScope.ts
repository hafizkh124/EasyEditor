/**
 * Applies the query planner's `scope.source_types` to the merged result list.
 *
 * Live measurement (2026-10-13, docs/PHASE0-DIAGNOSIS-URDU.md): asked for
 * "والدین کے ساتھ حسنِ سلوک کی احادیث" (hadith about kindness to parents), the
 * first two results were Qur'an verses. The planner had worked out the user
 * wanted hadith only ("only احادیث/hadith → [hadith]"), but nothing downstream
 * ever read that field: Tier A's Qur'an APIs and Tier K's Qur'an rows ran
 * regardless and, interleaved by rank, took the top slots.
 *
 * Deliberately one-directional and conservative: only a *confident* plan
 * (not the keyword-fallback) that asked for hadith alone removes Qur'an rows.
 * A Qur'an-only ask is left alone — tafsir and other rows have no reliable
 * "not Qur'an" marker, and cutting by guesswork would hide real answers.
 */
import type { QueryPlan } from "./queryPlanner.ts";

/** Domains whose rows are Qur'an text or a Qur'an translation/gloss. */
export const QURAN_DOMAINS: ReadonlySet<string> = new Set([
  "tanzil", "tanzil-urdu", "alquran", "quran-com", "islamicurdubooks-wbw",
]);

export function isHadithOnlyPlan(plan: Pick<QueryPlan, "degraded" | "scope"> | null | undefined): boolean {
  if (!plan || plan.degraded) return false;
  const types = plan.scope?.source_types ?? [];
  return types.length === 1 && types[0] === "hadith";
}

export function dropQuranRows<T extends { domain: string }>(
  rows: T[],
  plan: Pick<QueryPlan, "degraded" | "scope"> | null | undefined,
): T[] {
  return isHadithOnlyPlan(plan) ? rows.filter((r) => !QURAN_DOMAINS.has(r.domain)) : rows;
}
